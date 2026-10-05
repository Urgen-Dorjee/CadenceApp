import { Routes, Route } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import MainLayout from './components/layout/MainLayout'
import ErrorBoundary from './components/common/ErrorBoundary'
import HomePage from './pages/HomePage'
import { useBackend } from './hooks/useBackend'

const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="animate-spin text-muted" size={22} aria-label="Loading" />
    </div>
  )
}

export default function App() {
  useBackend()

  return (
    <MainLayout>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<ErrorBoundary fallbackTitle="Something went wrong on this page"><HomePage /></ErrorBoundary>} />
          <Route path="/jobs/:id" element={<ErrorBoundary fallbackTitle="Something went wrong while reviewing"><ReviewPage /></ErrorBoundary>} />
          <Route path="/library" element={<ErrorBoundary fallbackTitle="Something went wrong in the library"><LibraryPage /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary fallbackTitle="Something went wrong in settings"><SettingsPage /></ErrorBoundary>} />
        </Routes>
      </Suspense>
    </MainLayout>
  )
}
