import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { getReceipt, getStoreNames, saveReceipt, updateReceipt } from '@/client/lib/api'
import { CATEGORIES } from '@/shared/categories'
import type { OcrDraft, ReceiptItemInput } from '@/shared/types'

interface ConfirmPageState {
  draft: OcrDraft
  paymentMethodId: string
}

export function ConfirmPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: receiptId } = useParams<{ id: string }>()
  const state = location.state as ConfirmPageState | null

  const [loaded, setLoaded] = useState(!receiptId)
  const [storeName, setStoreName] = useState(state?.draft.store_name ?? '')
  const [purchasedAt, setPurchasedAt] = useState(state?.draft.purchased_at ?? '')
  const [paymentMethodId, setPaymentMethodId] = useState(state?.paymentMethodId ?? '')
  const [receiptTotal, setReceiptTotal] = useState<number | null>(state?.draft.receipt_total ?? null)
  const [imageKey, setImageKey] = useState(state?.draft.image_key ?? '')
  const [items, setItems] = useState<ReceiptItemInput[]>(state?.draft.items ?? [])
  const [storeNames, setStoreNames] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getStoreNames().then(setStoreNames)
  }, [])

  useEffect(() => {
    if (!receiptId) return
    getReceipt(receiptId).then((receipt) => {
      setStoreName(receipt.store_name)
      setPurchasedAt(receipt.purchased_at)
      setPaymentMethodId(receipt.payment_method_id)
      setReceiptTotal(receipt.receipt_total)
      setImageKey(receipt.image_key)
      setItems(receipt.items.map(({ name, price, quantity, category }) => ({ name, price, quantity, category })))
      setLoaded(true)
    })
  }, [receiptId])

  const itemsTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  )
  const mismatch = receiptTotal !== null && receiptTotal !== itemsTotal

  if (!receiptId && !state) {
    return <p className="text-sm text-muted-foreground">スキャンからやり直してください</p>
  }
  if (!loaded) {
    return <p className="text-sm text-muted-foreground">読み込み中...</p>
  }

  function updateItem(index: number, patch: Partial<ReceiptItemInput>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function addItem() {
    setItems((prev) => [...prev, { name: '', price: 0, quantity: 1, category: 'その他' }])
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        store_name: storeName,
        purchased_at: purchasedAt,
        payment_method_id: paymentMethodId,
        receipt_total: receiptTotal,
        image_key: imageKey,
        items,
      }
      if (receiptId) {
        await updateReceipt(receiptId, payload)
      } else {
        await saveReceipt(payload)
      }
      navigate('/history')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">内容を確認</h1>
        <p className="text-sm text-muted-foreground">読み取った内容を確認・修正して保存してください。</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>保存に失敗しました</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>レシート情報</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="store-name">店名</Label>
            <Input
              id="store-name"
              list="store-name-options"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
            />
            <datalist id="store-name-options">
              {storeNames.map((name) => <option key={name} value={name} />)}
            </datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor="purchased-at">購入日</Label>
            <Input
              id="purchased-at"
              type="date"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {mismatch && (
        <Alert variant="destructive">
          <AlertTitle>合計が一致しません</AlertTitle>
          <AlertDescription>
            レシートの合計({receiptTotal}円)と明細の合計({itemsTotal}円)が一致しません。
            見落としや読み取りミスがないか確認してください。
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>明細</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.map((item, index) => (
            <div key={index}>
              {index > 0 && <Separator className="mb-4" />}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[2fr_1fr_1fr_1.2fr_auto] sm:items-end">
                <div className="col-span-2 space-y-1.5 sm:col-span-1">
                  <Label htmlFor={`item-name-${index}`} className="text-xs text-muted-foreground">品名</Label>
                  <Input
                    id={`item-name-${index}`}
                    aria-label="品名"
                    value={item.name}
                    onChange={(e) => updateItem(index, { name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`item-price-${index}`} className="text-xs text-muted-foreground">単価</Label>
                  <Input
                    id={`item-price-${index}`}
                    type="number"
                    value={item.price}
                    onChange={(e) => updateItem(index, { price: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`item-quantity-${index}`} className="text-xs text-muted-foreground">数量</Label>
                  <Input
                    id={`item-quantity-${index}`}
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">カテゴリ</Label>
                  <Select value={item.category} onValueChange={(value) => updateItem(index, { category: value as ReceiptItemInput['category'] })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="削除"
                  className="justify-self-end text-neutral-400 hover:text-destructive"
                  onClick={() => removeItem(index)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addItem}>
            <Plus /> 行を追加
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between rounded-lg border bg-white px-5 py-4">
        <div>
          <p className="text-xs text-muted-foreground">明細合計</p>
          <p className="text-xl font-semibold tracking-tight">{itemsTotal.toLocaleString()}円</p>
        </div>
        <Button size="lg" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : 'OK'}
        </Button>
      </div>
    </div>
  )
}
