import { NavLink, Route, Routes } from 'react-router-dom'
import { Camera, History, Receipt, Wallet } from 'lucide-react'
import { ConfirmPage } from './pages/ConfirmPage'
import { HistoryPage } from './pages/HistoryPage'
import { PaymentMethodsPage } from './pages/PaymentMethodsPage'
import { ScanPage } from './pages/ScanPage'

const navItems = [
  { to: '/scan', label: 'スキャン', icon: Camera },
  { to: '/history', label: '履歴', icon: History },
  { to: '/payment-methods', label: '支払い方法', icon: Wallet },
]

export function App() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 md:flex">
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-white md:static md:inset-auto md:flex md:w-60 md:shrink-0 md:flex-col md:border-t-0 md:border-r">
        <div className="hidden items-center gap-2.5 px-6 py-6 md:flex">
          <span className="flex size-8 items-center justify-center rounded-lg bg-neutral-900 text-white">
            <Receipt size={17} />
          </span>
          <span className="text-base font-semibold tracking-tight">レシート記録</span>
        </div>
        <ul className="flex justify-around md:flex-col md:justify-start md:gap-0.5 md:px-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to} className="flex-1 md:flex-none">
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:py-2.5 md:text-sm ${
                    isActive
                      ? 'text-neutral-900 md:bg-neutral-900 md:text-white'
                      : 'text-neutral-500 hover:text-neutral-900 md:hover:bg-neutral-100'
                  }`
                }
              >
                <Icon size={20} className="md:size-4" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 pb-24 md:pb-0">
        <div className="mx-auto max-w-3xl px-4 py-8 md:px-10 md:py-12">
          <Routes>
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/confirm" element={<ConfirmPage />} />
            <Route path="/receipts/:id/edit" element={<ConfirmPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/payment-methods" element={<PaymentMethodsPage />} />
            <Route path="*" element={<ScanPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
