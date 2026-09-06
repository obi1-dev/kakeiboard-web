import { useEffect, useState } from 'react'
import { Plus, Trash2, Wallet } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createPaymentMethod, deletePaymentMethod, getPaymentMethods } from '@/client/lib/api'
import type { PaymentMethod } from '@/shared/types'

export function PaymentMethodsPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setMethods(await getPaymentMethods())
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleSave() {
    if (!name.trim()) return
    setError(null)
    try {
      await createPaymentMethod(name.trim())
      setName('')
      setOpen(false)
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('この支払い方法を削除しますか?')) return
    setError(null)
    try {
      await deletePaymentMethod(id)
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">支払い方法</h1>
          <p className="text-sm text-muted-foreground">現金・カードなど、レシート記録時に選ぶ支払い方法を管理します。</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus /> 追加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>支払い方法を追加</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="payment-method-name">名前</Label>
              <Input id="payment-method-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={handleSave}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="gap-0 py-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-11 px-4">名前</TableHead>
              <TableHead className="h-11 px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {methods.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={2} className="py-10 text-center text-sm text-muted-foreground">
                  支払い方法が登録されていません
                </TableCell>
              </TableRow>
            )}
            {methods.map((method) => (
              <TableRow key={method.id}>
                <TableCell className="px-4 py-3">
                  <span className="flex items-center gap-2.5 font-medium">
                    <span className="flex size-7 items-center justify-center rounded-md bg-neutral-100 text-neutral-500">
                      <Wallet size={14} />
                    </span>
                    {method.name}
                  </span>
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="削除"
                    className="text-neutral-400 hover:text-destructive"
                    onClick={() => handleDelete(method.id)}
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
