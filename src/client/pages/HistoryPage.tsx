import { useEffect, useState } from 'react'
import { Download, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { deleteReceipt, exportCsvUrl, getReceipts } from '@/client/lib/api'
import type { ReceiptWithItems } from '@/shared/types'

export function HistoryPage() {
  const [receipts, setReceipts] = useState<ReceiptWithItems[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  async function reload(filters: { from?: string; to?: string } = {}) {
    setReceipts(await getReceipts(filters))
  }

  useEffect(() => {
    reload()
  }, [])

  function handleFilter() {
    reload({ from: from || undefined, to: to || undefined })
  }

  async function handleDelete(id: string) {
    if (!window.confirm('この記録を削除しますか?')) return
    await deleteReceipt(id)
    await reload({ from: from || undefined, to: to || undefined })
  }

  function itemsTotal(receipt: ReceiptWithItems): number {
    return receipt.items.reduce((sum, item) => sum + item.amount, 0)
  }

  return (
    <div>
      <h1>履歴</h1>

      <Label htmlFor="from-date">開始日</Label>
      <Input id="from-date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Label htmlFor="to-date">終了日</Label>
      <Input id="to-date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
            <TableHead>合計</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {receipts.map((receipt) => (
            <TableRow key={receipt.id}>
              <TableCell>{receipt.purchased_at}</TableCell>
              <TableCell>{receipt.store_name}</TableCell>
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
