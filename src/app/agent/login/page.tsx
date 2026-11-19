import { LoginPage } from "@/components/login-page";
export const metadata = { title: "Agent sign in" };
export default function Page() {
  return <LoginPage portal="AGENT" />;
}
