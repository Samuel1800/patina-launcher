import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/onest/700.css';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/600.css';
import './styles.css';
import { StoreProvider } from './store.jsx';
import App from './App.jsx';
import Splash from './views/Splash.jsx';

document.body.classList.add(`platform-${window.bw ? window.bw.platform : 'web'}`);
const isSplash = window.location.hash.startsWith('#/splash');

createRoot(document.getElementById('root')).render(
  <StoreProvider>{isSplash ? <Splash /> : <App />}</StoreProvider>
);
