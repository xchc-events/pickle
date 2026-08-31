import { db } from '@/lib/db'
import { ROLE_LABEL, MODULES, type ModuleKey } from '@/lib/constants'
import { roleKeyOf } from '@/lib/session'
import { initialsOf } from '@/lib/format'
import { Brand } from '@/components/Brand'
import { Avatar } from '@/components/Avatar'
import { signInAs } from '../actions'
import styles from './sign-in.module.css'

// Reads the user table on every request: a signed-in list baked at build time
// would go stale the moment anyone is added or deactivated.
export const dynamic = 'force-dynamic'

/**
 * The prototype's role picker, kept as-is on purpose: what you can see and do
 * changes with the role, and that is the thing worth exercising. Real
 * accounts, invitations and deactivation replace this — the schema already
 * carries the Auth.js models for it.
 */
export default async function SignIn() {
  const users = await db.user.findMany({
    where: { active: true },
    include: { person: true },
    orderBy: { createdAt: 'asc' },
  })

  const perms = await db.modulePermission.findMany()
  const modulesByRole = new Map<string, ModuleKey[]>()
  for (const p of perms) {
    const list = modulesByRole.get(p.role) ?? []
    list.push(p.module as ModuleKey)
    modulesByRole.set(p.role, list)
  }

  return (
    <main className={styles.wrap}>
      <Brand />
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.blurb}>
        Pick a role to explore. What you can see and do changes with it.
      </p>

      <div className={styles.list}>
        {users.map((u) => {
          const roleKey = roleKeyOf(u.role)
          const mods = modulesByRole.get(u.role) ?? []
          const labels = MODULES.filter((m) => mods.includes(m.key))
            .map((m) => m.label)
            .join(' · ')
          return (
            <form key={u.id} action={signInAs}>
              <input type="hidden" name="userId" value={u.id} />
              <button type="submit" className={styles.row}>
                <Avatar
                  initials={u.person?.initials ?? initialsOf(u.name ?? u.email)}
                  title={u.name ?? ''}
                  accent={u.person?.initials === 'MT'}
                  external={u.role === 'PROMOTER'}
                />
                <span className={styles.who}>
                  <span className={styles.name}>{u.name}</span>
                  <span className={styles.role}>
                    {ROLE_LABEL[roleKey]}
                    {u.promoter ? ` · ${u.promoter}` : ''}
                  </span>
                </span>
                <span className={styles.mods}>{labels}</span>
              </button>
            </form>
          )
        })}
      </div>

      <p className={styles.foot}>
        There is no password here yet. The role you pick is held in a cookie and every permission
        decision is taken on the server from it — but anyone who can set that cookie can be anyone,
        so this is a stand-in for real sign-in, not the thing itself.
      </p>
    </main>
  )
}
