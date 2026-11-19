import { LoginPage } from "@/components/login-page";
export const metadata = { title: "Worker sign in" };
export default function Page() {
  return <LoginPage portal="WORKER" />;
}
