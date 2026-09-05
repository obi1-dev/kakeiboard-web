import { Link, Route, Routes } from 'react-router-dom'
import { PaymentMethodsPage } from './pages/PaymentMethodsPage'

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
          <Route path="/scan" element={<Placeholder title="スキャン" />} />
          <Route path="/history" element={<Placeholder title="履歴" />} />
          <Route path="/payment-methods" element={<PaymentMethodsPage />} />
          <Route path="/confirm" element={<Placeholder title="確認" />} />
          <Route path="*" element={<Placeholder title="スキャン" />} />
        </Routes>
      </main>
    </div>
  )
}
