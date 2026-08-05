import { MobileAuthFlow } from '../auth-flow'

export const metadata = { title: 'Створити акаунт' }

export default function MobileRegisterPage() {
  return <MobileAuthFlow mode="register" />
}
