import { useEffect, useState } from 'react'
import { Download, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DatePicker } from '@/components/date-picker'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">履歴</h1>
          <p className="text-sm text-muted-foreground">保存したレシートの一覧です。</p>
        </div>
        <Button asChild variant="outline">
          <a href={exportCsvUrl(from || undefined, to || undefined)}>
            <Download /> CSVダウンロード
          </a>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="from-date">開始日</Label>
            <DatePicker id="from-date" value={from} onChange={setFrom} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="to-date">終了日</Label>
            <DatePicker id="to-date" value={to} onChange={setTo} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-name-filter">店名</Label>
            <Input
              id="store-name-filter"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-method-filter">支払い方法</Label>
            <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
              <SelectTrigger id="payment-method-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PAYMENT_METHODS}>すべて</SelectItem>
                {paymentMethods.map((method) => (
                  <SelectItem key={method.id} value={method.id}>{method.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleFilter}>絞り込む</Button>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 px-4">購入日</TableHead>
              <TableHead className="h-11 px-4">店名</TableHead>
              <TableHead className="h-11 px-4">支払い方法</TableHead>
              <TableHead className="h-11 px-4 text-right">合計</TableHead>
              <TableHead className="h-11 px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  該当するレシートがありません
                </TableCell>
              </TableRow>
            )}
            {receipts.map((receipt) => (
              <TableRow key={receipt.id}>
                <TableCell className="px-4 py-3">{receipt.purchased_at}</TableCell>
                <TableCell className="px-4 py-3 font-medium">{receipt.store_name}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {paymentMethodName(receipt.payment_method_id)}
                </TableCell>
                <TableCell className="px-4 py-3 text-right tabular-nums">
                  {itemsTotal(receipt).toLocaleString()}円
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <Button asChild variant="ghost" size="icon" aria-label="編集">
                    <Link to={`/receipts/${receipt.id}/edit`}>
                      <Pencil />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="削除"
                    className="text-neutral-400 hover:text-destructive"
                    onClick={() => handleDelete(receipt.id)}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
