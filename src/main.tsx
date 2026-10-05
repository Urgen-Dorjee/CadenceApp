import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/globals.css'
import { Toaster } from 'react-hot-toast'
import { setupGlobalErrorHandlers } from './services/errorLogger'

setupGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'rgb(var(--raised))',
            color: 'rgb(var(--ink))',
            border: '1px solid rgb(var(--line))', fontSize: '13px',
          },
        }}
      />
    </HashRouter>
  </React.StrictMode>
)
