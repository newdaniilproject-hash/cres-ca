import { MobileAuthFlow } from '../auth-flow'

export const metadata = { title: 'Вхід' }

export default function MobileLoginPage() {
  return <MobileAuthFlow mode="login" />
}
