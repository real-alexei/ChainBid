export async function retry<T>(
  attempts: number,
  delayMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}
