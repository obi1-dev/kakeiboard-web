import { Link, Route, Routes } from 'react-router-dom'
import { ConfirmPage } from './pages/ConfirmPage'
import { PaymentMethodsPage } from './pages/PaymentMethodsPage'
import { ScanPage } from './pages/ScanPage'

function Placeholder({ title }: { title: string }) {
  return <p>{title}</p>
}

export function App() {
  return (
    <div>
      <nav>
        <Link to="/scan">スキャン</Link>
        <Link to="/history">履歴</Link>
        <Link to="/payment-methods">支払い方法</Link>
      </nav>
      <main>
        <Routes>
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/history" element={<Placeholder title="履歴" />} />
          <Route path="/payment-methods" element={<PaymentMethodsPage />} />
          <Route path="/confirm" element={<ConfirmPage />} />
          <Route path="/receipts/:id/edit" element={<ConfirmPage />} />
          <Route path="*" element={<ScanPage />} />
        </Routes>
      </main>
    </div>
  )
}
