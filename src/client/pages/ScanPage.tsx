import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ImagePlus, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { getPaymentMethods, OcrError, runOcr } from '@/client/lib/api'
import { resizeImage } from '@/client/lib/resizeImage'
import type { PaymentMethod } from '@/shared/types'

export function ScanPage() {
  const navigate = useNavigate()
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [paymentMethodId, setPaymentMethodId] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedImageKey, setFailedImageKey] = useState<string | undefined>(undefined)

  useEffect(() => {
    getPaymentMethods().then((list) => {
      setMethods(list)
      if (list.length > 0) setPaymentMethodId(list[0].id)
    })
  }, [])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function handleScan() {
    if (!file || !paymentMethodId) return
    setLoading(true)
    setError(null)
    setFailedImageKey(undefined)
    try {
      const resized = await resizeImage(file, 1600, 0.8)
      const draft = await runOcr(resized)
      navigate('/confirm', { state: { draft, paymentMethodId } })
    } catch (err) {
      setError((err as Error).message)
      if (err instanceof OcrError) {
        setFailedImageKey(err.imageKey)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleManualEntry() {
    navigate('/confirm', {
      state: {
        draft: {
          store_name: '',
          purchased_at: new Date().toISOString().slice(0, 10),
          receipt_total: null,
          items: [],
          image_key: failedImageKey ?? '',
        },
        paymentMethodId,
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">レシートをスキャン</h1>
        <p className="text-sm text-muted-foreground">
          支払い方法を選んで画像をアップロードすると、品目を自動で読み取ります。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>レシート情報</CardTitle>
          <CardDescription>支払い方法とレシート画像を指定してください。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="payment-method-select">支払い方法</Label>
            <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
              <SelectTrigger id="payment-method-select" className="w-full sm:w-64">
                <SelectValue placeholder="支払い方法を選択" />
              </SelectTrigger>
              <SelectContent>
                {methods.map((method) => (
                  <SelectItem key={method.id} value={method.id}>{method.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="receipt-image">レシート画像</Label>
            {previewUrl ? (
              <label
                htmlFor="receipt-image"
                className="group relative flex cursor-pointer flex-col items-center overflow-hidden rounded-lg border bg-neutral-50"
              >
                <img
                  src={previewUrl}
                  alt="選択したレシート画像のプレビュー"
                  className="max-h-80 w-full object-contain"
                />
                <span className="flex w-full items-center justify-center gap-1.5 border-t bg-white py-2 text-sm font-medium text-neutral-700 group-hover:bg-neutral-100">
                  <RefreshCw size={14} /> 別の画像に変更
                </span>
              </label>
            ) : (
              <label
                htmlFor="receipt-image"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-6 py-8 text-center transition-colors hover:border-neutral-400 hover:bg-neutral-100"
              >
                <ImagePlus className="text-neutral-400" size={28} />
                <span className="text-sm font-medium text-neutral-700">タップして画像を選択</span>
                <span className="text-xs text-muted-foreground">JPEG・PNG</span>
              </label>
            )}
            <input
              id="receipt-image"
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <Button
            className="w-full sm:w-auto"
            onClick={handleScan}
            disabled={!file || !paymentMethodId || loading}
          >
            <Camera /> {loading ? 'スキャン中...' : 'スキャン開始'}
          </Button>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>読み取りに失敗しました</AlertTitle>
              <AlertDescription className="gap-3">
                <p>{error}(もう一度試すか、手動入力してください)</p>
                <Button variant="outline" size="sm" onClick={handleManualEntry}>手動入力へ</Button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
