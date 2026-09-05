import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { getPaymentMethods, runOcr } from '@/client/lib/api'
import { resizeImage } from '@/client/lib/resizeImage'
import type { PaymentMethod } from '@/shared/types'

export function ScanPage() {
  const navigate = useNavigate()
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [paymentMethodId, setPaymentMethodId] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPaymentMethods().then((list) => {
      setMethods(list)
      if (list.length > 0) setPaymentMethodId(list[0].id)
    })
  }, [])

  async function handleScan() {
    if (!file || !paymentMethodId) return
    setLoading(true)
    setError(null)
    try {
      const resized = await resizeImage(file, 1600, 0.8)
      const draft = await runOcr(resized)
      navigate('/confirm', { state: { draft, paymentMethodId } })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1>レシートをスキャン</h1>

      <Label htmlFor="payment-method-select">支払い方法</Label>
      <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
        <SelectTrigger id="payment-method-select">
          <SelectValue placeholder="支払い方法を選択" />
        </SelectTrigger>
        <SelectContent>
          {methods.map((method) => (
            <SelectItem key={method.id} value={method.id}>{method.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Label htmlFor="receipt-image">レシート画像</Label>
      <input
        id="receipt-image"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <Button onClick={handleScan} disabled={!file || !paymentMethodId || loading}>
        <Camera /> {loading ? 'スキャン中...' : 'スキャン開始'}
      </Button>

      {error && (
        <p role="alert">
          {error}(もう一度試すか、確認画面で手動入力してください)
        </p>
      )}
    </div>
  )
}
