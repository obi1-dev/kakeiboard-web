import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
    <div>
      <h1>支払い方法</h1>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>追加</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>支払い方法を追加</DialogTitle>
          </DialogHeader>
          <Label htmlFor="payment-method-name">名前</Label>
          <Input id="payment-method-name" value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名前</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {methods.map((method) => (
            <TableRow key={method.id}>
              <TableCell>{method.name}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" aria-label="削除" onClick={() => handleDelete(method.id)}>
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
