import Link from "next/link";
import { GenderField, PersonAvatar } from "./person-avatar";
import { ImageInput } from "./image-input";
import { changePasswordAction, changePhotoAction, updateProfileAction } from "@/app/actions/account";
import { formatDateTime } from "@/server/lib/dates";
import { getOwnProfile } from "@/server/modules/account/service";
import type { Actor } from "@/server/rbac/actor";
import { ActionForm, SubmitButton } from "./action-form";
import { Card, PageHeader } from "./ui";

const TABS = [
  ["profile", "My profile"],
  ["password", "Change password"],
  ["picture", "Change picture"],
] as const;

/** Shared "My profile" page used by every portal. */
export async function AccountPage({ actor, base, tab }: { actor: Actor; base: string; tab?: string }) {
  const me = await getOwnProfile(actor);
  const active = TABS.some(([k]) => k === tab) ? tab : "profile";
  const avatar = me.photoUrl ? `/api/avatar/${me.id}?v=${me.updatedAt.getTime()}` : null;
  return (
    <>
      <PageHeader title="My profile" subtitle={`${me.role.name}${me.branches.length ? ` · ${me.branches.map((b) => b.branch.name).join(", ")}` : ""}`} />
      <div className="grid gap-5 lg:grid-cols-4">
        <div className="card h-fit p-5 text-center">
          <PersonAvatar src={avatar} gender={me.gender} name={me.name} size={96} className="mx-auto" />
          <p className="mt-3 font-semibold">{me.name}</p>
          <p className="text-sm text-slate-500">{me.email}</p>
          <p className="mt-1 text-xs text-slate-400">Last sign-in {me.lastLoginAt ? formatDateTime(me.lastLoginAt) : "—"}</p>
          <nav className="mt-4 space-y-1 text-left text-sm">
            {TABS.map(([k, label]) => (
              <Link key={k} href={`${base}?tab=${k}`} className={`block rounded-lg px-3 py-2 ${active === k ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}>{label}</Link>
            ))}
          </nav>
        </div>
        <div className="lg:col-span-3">
          {active === "profile" && (
            <Card title="My profile">
              <ActionForm action={updateProfileAction} className="grid max-w-xl gap-3">
                <div><label className="label">Name</label><input name="name" required defaultValue={me.name} className="input" /></div>
                <div><label className="label">Email (sign-in)</label><input value={me.email} disabled className="input" /><p className="mt-1 text-xs text-slate-500">Ask an administrator to change your sign-in email.</p></div>
                <div><label className="label">Phone</label><input name="phone" defaultValue={me.phone ?? ""} className="input" /></div>
                <GenderField value={me.gender} />
                <p className="-mt-1 text-xs text-slate-500">Used for your default picture when you haven&apos;t uploaded a photo.</p>
                <div><SubmitButton>Save profile</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
          {active === "password" && (
            <Card title="Change password">
              <ActionForm action={changePasswordAction} resetOnSuccess className="grid max-w-md gap-3">
                <div><label className="label">Current password</label><input name="current" type="password" required autoComplete="current-password" className="input" /></div>
                <div><label className="label">New password</label><input name="next" type="password" required autoComplete="new-password" className="input" /><p className="mt-1 text-xs text-slate-500">At least 8 characters with a letter and a number.</p></div>
                <div><label className="label">Confirm new password</label><input name="confirm" type="password" required autoComplete="new-password" className="input" /></div>
                <div><SubmitButton>Change password</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
          {active === "picture" && (
            <Card title="Change picture">
              <ActionForm action={changePhotoAction} resetOnSuccess className="grid max-w-md gap-3">
                <ImageInput name="photo" accept="image/jpeg,image/png,image/webp" required aspect={1} maxEdge={800} label="Choose picture" />
                <p className="text-xs text-slate-500">Square photo works best. JPG, PNG or WEBP, up to 5 MB.</p>
                <div><SubmitButton>Upload picture</SubmitButton></div>
              </ActionForm>
              {avatar && (
                <ActionForm action={changePhotoAction} confirm="Remove your picture?" className="mt-4 border-t border-slate-100 pt-4">
                  <input type="hidden" name="remove" value="1" />
                  <SubmitButton className="text-sm text-red-700">Remove picture</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
