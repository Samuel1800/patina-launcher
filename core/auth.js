'use strict';
// Microsoft-/Xbox-/Minecraft-Anmeldung (ohne Fenster-Teil; der liegt in electron/).
const crypto = require('crypto');
const http = require('./http');

// Standard: öffentlicher Microsoft-Live-Client (wie bei vielen Open-Source-Launchern).
const LIVE = {
  mode: 'live',
  clientId: '00000000402b5328',
  authorize: 'https://login.live.com/oauth20_authorize.srf',
  token: 'https://login.live.com/oauth20_token.srf',
  redirect: 'https://login.live.com/oauth20_desktop.srf',
  scope: 'service::user.auth.xboxlive.com::MBI_SSL',
  ticketPrefixes: ['', 'd=', 't='],
};

/** Eigene Azure-App (falls in den Einstellungen hinterlegt). */
function azureConfig(clientId) {
  return {
    mode: 'azure',
    clientId,
    authorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    redirect: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
    scope: 'XboxLive.signin offline_access',
    ticketPrefixes: ['d=', ''],
  };
}

function configFor(customClientId) {
  return customClientId && customClientId.trim() ? azureConfig(customClientId.trim()) : LIVE;
}

function authorizeUrl(cfg) {
  const state = crypto.randomBytes(12).toString('hex');
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirect,
    scope: cfg.scope,
    prompt: 'select_account',
    state,
  });
  return { url: `${cfg.authorize}?${q.toString()}`, state };
}

class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function msToken(cfg, params) {
  try {
    const r = await http.getJson(cfg.token, {
      method: 'POST',
      form: { client_id: cfg.clientId, redirect_uri: cfg.redirect, scope: cfg.scope, ...params },
      retries: 1,
    });
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + (r.expires_in || 3600) * 1000 };
  } catch (e) {
    if (e.status === 400 || e.status === 401) {
      throw new AuthError('Die Microsoft-Anmeldung ist abgelaufen. Bitte melde dich neu an.', 'MS_EXPIRED');
    }
    throw e;
  }
}

const exchangeCode = (cfg, code) => msToken(cfg, { code, grant_type: 'authorization_code' });
const refreshMs = (cfg, refreshToken) => msToken(cfg, { refresh_token: refreshToken, grant_type: 'refresh_token' });

async function xboxLive(cfg, msAccessToken) {
  let lastErr;
  for (const prefix of cfg.ticketPrefixes) {
    try {
      const r = await http.getJson('https://user.auth.xboxlive.com/user/authenticate', {
        method: 'POST',
        headers: { Accept: 'application/json', 'x-xbl-contract-version': '1' },
        json: {
          Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `${prefix}${msAccessToken}` },
          RelyingParty: 'http://auth.xboxlive.com',
          TokenType: 'JWT',
        },
        retries: 1,
      });
      return { token: r.Token, uhs: r.DisplayClaims.xui[0].uhs };
    } catch (e) {
      lastErr = e;
      if (!(e.status === 400 || e.status === 401)) throw e;
    }
  }
  throw new AuthError(`Xbox-Live-Anmeldung fehlgeschlagen (${lastErr && lastErr.status}).`, 'XBL');
}

const XERR = {
  2148916227: 'Dieser Account ist bei Xbox gesperrt.',
  2148916229: 'Der Account ist eingeschränkt (Jugendschutz). Ein Elternteil muss Online-Spielen erlauben.',
  2148916233: 'Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil. Melde dich einmal auf minecraft.net an und versuche es dann erneut.',
  2148916235: 'Xbox Live ist in deinem Land nicht verfügbar.',
  2148916236: 'Für diesen Account ist eine Altersverifizierung bei Xbox nötig.',
  2148916237: 'Für diesen Account ist eine Altersverifizierung bei Xbox nötig.',
  2148916238: 'Das ist ein Kinderkonto – es muss von einem Erwachsenen zu einer Microsoft-Familie hinzugefügt werden.',
};

async function xsts(xblToken) {
  try {
    const r = await http.getJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      method: 'POST',
      headers: { Accept: 'application/json', 'x-xbl-contract-version': '1' },
      json: { Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' },
      retries: 1,
    });
    const xui = r.DisplayClaims.xui[0];
    return { token: r.Token, uhs: xui.uhs, xid: xui.xid };
  } catch (e) {
    if (e.status === 401) {
      let code;
      try {
        code = JSON.parse(e.body).XErr;
      } catch {}
      throw new AuthError(XERR[code] || `Xbox-Autorisierung abgelehnt (${code || 401}).`, 'XSTS');
    }
    throw e;
  }
}

async function minecraftLogin(uhs, xstsToken) {
  try {
    const r = await http.getJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
      method: 'POST',
      json: { identityToken: `XBL3.0 x=${uhs};${xstsToken}` },
      retries: 2,
    });
    return { accessToken: r.access_token, expiresAt: Date.now() + (r.expires_in || 86400) * 1000 };
  } catch (e) {
    if (e.status === 403) {
      throw new AuthError('Minecraft hat die Anmeldung abgelehnt (403). Mit einer eigenen Azure-App-ID in den Einstellungen klappt es ggf.', 'MC_FORBIDDEN');
    }
    throw e;
  }
}

async function minecraftProfile(mcToken) {
  try {
    return await http.getJson('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${mcToken}` },
      retries: 2,
    });
  } catch (e) {
    if (e.status === 404) {
      throw new AuthError('Auf diesem Microsoft-Konto ist kein Minecraft: Java Edition gekauft (oder noch kein Profilname angelegt).', 'NO_GAME');
    }
    throw e;
  }
}

/** Kompletter Ablauf ab Microsoft-Token. */
async function loginWithMs(cfg, ms) {
  const xbl = await xboxLive(cfg, ms.accessToken);
  const x = await xsts(xbl.token);
  const mc = await minecraftLogin(x.uhs, x.token);
  const profile = await minecraftProfile(mc.accessToken);
  const skin = (profile.skins || []).find((s) => s.state === 'ACTIVE') || (profile.skins || [])[0];
  return {
    id: profile.id,
    uuid: profile.id,
    name: profile.name,
    type: 'msa',
    skinUrl: skin ? skin.url : null,
    skinVariant: skin ? skin.variant : null,
    accessToken: mc.accessToken,
    expiresAt: mc.expiresAt,
    xuid: x.xid || null,
    msRefreshToken: ms.refreshToken,
    clientMode: cfg.mode,
    clientId: cfg.clientId,
  };
}

module.exports = { LIVE, azureConfig, configFor, authorizeUrl, exchangeCode, refreshMs, loginWithMs, AuthError };
