/** Runtime gate shared by Tungsten registration and every UI surface. */
export function isTungstenEnabled(): boolean {
  return process.env.USER_TYPE === 'ant'
}
