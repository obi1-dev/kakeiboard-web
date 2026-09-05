import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
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
    return <p>スキャンからやり直してください</p>
  }
  if (!loaded) {
    return <p>読み込み中...</p>
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
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1>確認</h1>

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

      <Label htmlFor="purchased-at">購入日</Label>
      <Input
        id="purchased-at"
        type="date"
        value={purchasedAt}
        onChange={(e) => setPurchasedAt(e.target.value)}
      />

      {mismatch && (
        <Alert variant="destructive">
          <AlertTitle>合計が一致しません</AlertTitle>
          <AlertDescription>
            レシートの合計({receiptTotal}円)と明細の合計({itemsTotal}円)が一致しません。
            見落としや読み取りミスがないか確認してください。
          </AlertDescription>
        </Alert>
      )}

      {items.map((item, index) => (
        <div key={index}>
          <Label htmlFor={`item-name-${index}`}>品名</Label>
          <Input
            id={`item-name-${index}`}
            aria-label="品名"
            value={item.name}
            onChange={(e) => updateItem(index, { name: e.target.value })}
          />
          <Label htmlFor={`item-price-${index}`}>単価</Label>
          <Input
            id={`item-price-${index}`}
            type="number"
            value={item.price}
            onChange={(e) => updateItem(index, { price: Number(e.target.value) })}
          />
          <Label htmlFor={`item-quantity-${index}`}>数量</Label>
          <Input
            id={`item-quantity-${index}`}
            type="number"
            value={item.quantity}
            onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
          />
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
          <Button variant="ghost" size="icon" aria-label="削除" onClick={() => removeItem(index)}>
            <Trash2 />
          </Button>
        </div>
      ))}

      <Button variant="outline" onClick={addItem}>
        <Plus /> 行を追加
      </Button>

      <p>明細合計: {itemsTotal}円</p>

      <Button onClick={handleSave} disabled={saving}>OK</Button>
    </div>
  )
}
