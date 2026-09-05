import { NavLink, Route, Routes } from 'react-router-dom'
import { Camera, History, Wallet } from 'lucide-react'
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
    <div className="min-h-screen bg-neutral-50 text-neutral-900 pb-16 md:pb-0 md:flex">
      <nav className="border-b md:border-b-0 md:border-r md:w-56 md:shrink-0 fixed bottom-0 left-0 right-0 md:static bg-white z-10">
        <ul className="flex md:flex-col justify-around md:justify-start md:gap-1 md:p-4">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to} className="flex-1 md:flex-none">
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex flex-col md:flex-row items-center gap-1 md:gap-2 p-3 rounded-md text-sm ${
                    isActive ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`
                }
              >
                <Icon size={20} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 p-4 md:p-8 max-w-2xl">
        <Routes>
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/confirm" element={<ConfirmPage />} />
          <Route path="/receipts/:id/edit" element={<ConfirmPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/payment-methods" element={<PaymentMethodsPage />} />
          <Route path="*" element={<ScanPage />} />
        </Routes>
      </main>
    </div>
  )
}
