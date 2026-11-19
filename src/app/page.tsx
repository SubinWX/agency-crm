import { LoginPage } from "@/components/login-page";

export const dynamic = "force-dynamic";

/** Home = sign in (Office tab selected; Agent / Worker tabs switch portal). */
export default function Home() {
  return <LoginPage portal="ADMIN" />;
}
