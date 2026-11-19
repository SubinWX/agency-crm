import { setRolePermissionsAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/server/auth/session";
import { listRoles } from "@/server/modules/users/service";
import { ALL_PERMISSION_KEYS, PERMISSIONS } from "@/server/rbac/permissions";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  await requirePagePermission("ADMIN", "roles.manage");
  const roles = (await listRoles()).filter((r) => r.portal !== "CUSTOMER");
  const groups = ALL_PERMISSION_KEYS.reduce<Record<string, string[]>>((acc, k) => {
    (acc[PERMISSIONS[k][0]] ??= []).push(k);
    return acc;
  }, {});
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Changes apply on the user's next request. The server enforces every permission." />
      <div className="space-y-5">
        {roles.map((role) => {
          const has = new Set(role.permissions.map((p) => p.permission.key));
          return (
            <Card key={role.id} title={`${role.name} · ${role.portal.toLowerCase()} portal`}>
              {role.isSuperAdmin ? (
                <p className="text-sm text-slate-600">Super Admin always has every permission and access to all branches.</p>
              ) : (
                <ActionForm action={setRolePermissionsAction.bind(null, role.id)}>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(groups).map(([group, keys]) => (
                      <fieldset key={group}>
                        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</legend>
                        {keys.map((k) => (
                          <label key={k} className="flex items-start gap-2 py-0.5 text-sm">
                            <input type="checkbox" name="perm" value={k} defaultChecked={has.has(k)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
                            <span>{PERMISSIONS[k as keyof typeof PERMISSIONS][1]}</span>
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                  <SubmitButton>Save {role.name} permissions</SubmitButton>
                </ActionForm>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
