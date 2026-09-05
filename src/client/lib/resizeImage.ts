export async function resizeImage(file: File, maxDimension: number, quality: number): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1) {
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return file
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) {
      return file
    }
    return new File([blob], file.name, { type: 'image/jpeg' })
  } catch {
    // createImageBitmap / canvas がテスト環境(jsdom)や一部ブラウザで
    // 使えない場合は、リサイズせず元ファイルをそのまま使う
    return file
  }
}
