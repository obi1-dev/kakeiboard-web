import { useEffect, useState } from 'react'
import { Download, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  deleteReceipt, exportCsvUrl, getPaymentMethods, getReceipts,
} from '@/client/lib/api'
import type { PaymentMethod, ReceiptWithItems } from '@/shared/types'

const ALL_PAYMENT_METHODS = '__all__'

export function HistoryPage() {
  const [receipts, setReceipts] = useState<ReceiptWithItems[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [storeName, setStoreName] = useState('')
  const [paymentMethodId, setPaymentMethodId] = useState(ALL_PAYMENT_METHODS)
  const [error, setError] = useState<string | null>(null)

  function currentFilters() {
    return {
      from: from || undefined,
      to: to || undefined,
      store_name: storeName || undefined,
      payment_method_id: paymentMethodId === ALL_PAYMENT_METHODS ? undefined : paymentMethodId,
    }
  }

  async function reload(filters: {
    from?: string; to?: string; store_name?: string; payment_method_id?: string
  } = {}) {
    setReceipts(await getReceipts(filters))
  }

  useEffect(() => {
    reload()
    getPaymentMethods().then(setPaymentMethods)
  }, [])

  async function handleFilter() {
    setError(null)
    try {
      await reload(currentFilters())
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('この記録を削除しますか?')) return
    setError(null)
    try {
      await deleteReceipt(id)
      await reload(currentFilters())
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function itemsTotal(receipt: ReceiptWithItems): number {
    return receipt.items.reduce((sum, item) => sum + item.amount, 0)
  }

  function paymentMethodName(id: string): string {
    return paymentMethods.find((m) => m.id === id)?.name ?? ''
  }

  return (
    <div>
      <h1>履歴</h1>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Label htmlFor="from-date">開始日</Label>
      <Input id="from-date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Label htmlFor="to-date">終了日</Label>
      <Input id="to-date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      <Label htmlFor="store-name-filter">店名</Label>
      <Input
        id="store-name-filter"
        value={storeName}
        onChange={(e) => setStoreName(e.target.value)}
      />
      <Label htmlFor="payment-method-filter">支払い方法</Label>
      <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
        <SelectTrigger id="payment-method-filter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_PAYMENT_METHODS}>すべて</SelectItem>
          {paymentMethods.map((method) => (
            <SelectItem key={method.id} value={method.id}>{method.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={handleFilter}>絞り込む</Button>

      <Button asChild variant="outline">
        <a href={exportCsvUrl(from || undefined, to || undefined)}>
          <Download /> CSVダウンロード
        </a>
      </Button>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>購入日</TableHead>
            <TableHead>店名</TableHead>
            <TableHead>支払い方法</TableHead>
            <TableHead>合計</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {receipts.map((receipt) => (
            <TableRow key={receipt.id}>
              <TableCell>{receipt.purchased_at}</TableCell>
              <TableCell>{receipt.store_name}</TableCell>
              <TableCell>{paymentMethodName(receipt.payment_method_id)}</TableCell>
              <TableCell>{itemsTotal(receipt)}円</TableCell>
              <TableCell>
                <Button asChild variant="ghost" size="icon" aria-label="編集">
                  <Link to={`/receipts/${receipt.id}/edit`}>
                    <Pencil />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" aria-label="削除" onClick={() => handleDelete(receipt.id)}>
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
