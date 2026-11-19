import { LoginPage } from "@/components/login-page";
export const metadata = { title: "Customer sign in" };
export default function Page() {
  return <LoginPage portal="CUSTOMER" />;
}
