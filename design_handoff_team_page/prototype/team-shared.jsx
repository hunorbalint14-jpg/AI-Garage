// team-shared.jsx — tokens, primitives and data shared across the three
// Team-page directions. Faithful to the AI Garage dark shadcn theme
// (globals.css OKLCH neutrals + the dark badge colour overrides).

const T = {
  bg: 'oklch(0.145 0 0)',
  card: 'oklch(0.205 0 0)',
  cardHi: 'oklch(0.23 0 0)',
  fg: 'oklch(0.985 0 0)',
  muted: 'oklch(0.269 0 0)',
  mutedFg: 'oklch(0.708 0 0)',
  border: 'oklch(1 0 0 / 12%)',
  borderStrong: 'oklch(1 0 0 / 18%)',
  input: 'oklch(1 0 0 / 22%)',
  primary: 'oklch(0.922 0 0)',
  primaryFg: 'oklch(0.205 0 0)',
  destructive: 'oklch(0.704 0.191 22.216)',
  radius: '10px',
  radiusSm: '7px',
  font: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
};

// Role → colour mapping (dark-mode values lifted from globals.css overrides).
const ROLE_COLORS = {
  owner:    { fg: 'rgb(253 211 77)',  bg: 'rgb(253 211 77 / 0.13)', label: 'owner' },
  admin:    { fg: 'rgb(147 197 253)', bg: 'rgb(147 197 253 / 0.13)', label: 'admin' },
  mechanic: { fg: 'rgb(134 239 172)', bg: 'rgb(134 239 172 / 0.13)', label: 'Mechanic' },
  staff:    { fg: 'oklch(0.78 0 0)',  bg: 'rgb(255 255 255 / 0.07)', label: 'Staff (legacy)' },
};

const MEMBERS = [
  {
    id: 'rob', initials: 'RT', name: 'Rob Test', email: 'rdaily895@gmail.com',
    role: 'owner', scope: 'All locations', you: true, mfa: true,
    access: 'full', perms: null, skills: [],
  },
  {
    id: 'adam-o', initials: 'AO', name: 'Adam Offra', name2: '(staff)', email: 'offrakisadi@gmail.com',
    role: 'admin', scope: 'All locations', you: false, mfa: false,
    access: 'full', perms: null, skills: [], editable: false,
  },
  {
    id: 'adam-t', initials: 'AT', name: 'Adam Test', email: 'offrakis@icloud.com',
    role: 'mechanic', scope: 'test Garage', you: false, mfa: false,
    access: 'scoped', perms: 8,
    skills: [
      { label: 'MOT tester', tone: 'blue' },
      { label: 'QC reviewer', tone: 'blue' },
      { label: 'EV L3', tone: 'green' },
    ],
    editable: true,
  },
  {
    id: 'szandra', initials: 'SD', name: 'Szandra Debity', email: 'szandidebity@gmail.com',
    role: 'staff', scope: 'Colindale', you: false, mfa: false,
    access: 'scoped', perms: 3, skills: [], editable: true,
  },
];

/* ── Icons (simple geometric strokes only) ─────────────────── */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };

function IconSearch({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function IconChevron({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function IconDots({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}
function IconPlus({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/* ── Avatar ─────────────────────────────────────────────────── */
function Avatar({ member, size = 38 }) {
  const c = ROLE_COLORS[member.role] || ROLE_COLORS.staff;
  return (
    <div
      style={{
        width: size, height: size, flex: '0 0 auto',
        borderRadius: '50%',
        background: c.bg,
        boxShadow: `inset 0 0 0 1px ${c.fg.replace(')', ' / 0.28)').replace('rgb', 'rgb').replace('oklch(0.78 0 0', 'oklch(0.78 0 0')}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: c.fg, fontWeight: 600,
        fontSize: size * 0.36, letterSpacing: '0.02em',
      }}
    >
      {member.initials}
    </div>
  );
}

/* ── Badges & chips ─────────────────────────────────────────── */
function RoleBadge({ role }) {
  const c = ROLE_COLORS[role] || ROLE_COLORS.staff;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 500,
      color: c.fg, background: c.bg, whiteSpace: 'nowrap',
    }}>{c.label}</span>
  );
}

function SkillChip({ label, tone }) {
  const tones = {
    blue:  { fg: 'rgb(147 197 253)', bg: 'rgb(147 197 253 / 0.12)' },
    green: { fg: 'rgb(134 239 172)', bg: 'rgb(134 239 172 / 0.12)' },
  };
  const c = tones[tone] || tones.blue;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1.5px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 500,
      color: c.fg, background: c.bg, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function MfaBadge({ on }) {
  return on ? (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 500,
      color: 'rgb(134 239 172)', background: 'rgb(134 239 172 / 0.12)', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgb(134 239 172)' }} />
      MFA on
    </span>
  ) : (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 500,
      color: T.mutedFg, background: 'rgb(255 255 255 / 0.05)', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.mutedFg, opacity: 0.7 }} />
      No MFA
    </span>
  );
}

function PermCount({ n }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: T.mutedFg }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgb(134 239 172)' }} />
      {n} permissions
    </span>
  );
}

/* ── Buttons ────────────────────────────────────────────────── */
function PrimaryBtn({ children, style }) {
  return (
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 34, padding: '0 14px', border: 'none', cursor: 'pointer',
      borderRadius: T.radius, background: T.primary, color: T.primaryFg,
      fontSize: 13, fontWeight: 600, fontFamily: T.font, whiteSpace: 'nowrap',
      ...style,
    }}>{children}</button>
  );
}

function GhostIconBtn({ active }) {
  return (
    <button style={{
      width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 8, cursor: 'pointer',
      border: `1px solid ${active ? T.borderStrong : 'transparent'}`,
      background: active ? T.muted : 'transparent',
      color: active ? T.fg : T.mutedFg,
    }}>
      <IconDots />
    </button>
  );
}

function EditBtn() {
  return (
    <button style={{
      display: 'inline-flex', alignItems: 'center',
      height: 30, padding: '0 12px', cursor: 'pointer',
      borderRadius: 8, border: `1px solid ${T.input}`,
      background: 'rgb(255 255 255 / 0.04)', color: T.fg,
      fontSize: 12.5, fontWeight: 500, fontFamily: T.font,
    }}>Edit</button>
  );
}

/* ── Overflow menu popover (static, for demos) ──────────────── */
function OverflowMenu({ items }) {
  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30,
      minWidth: 168, padding: 5,
      background: T.card, border: `1px solid ${T.borderStrong}`,
      borderRadius: 10, boxShadow: '0 16px 40px rgb(0 0 0 / 0.55)',
    }}>
      {items.map((it, i) => (
        it.sep ? (
          <div key={i} style={{ height: 1, background: T.border, margin: '5px 4px' }} />
        ) : (
          <div key={i} style={{
            padding: '7px 10px', borderRadius: 6, fontSize: 13,
            color: it.danger ? T.destructive : T.fg,
            background: it.hover ? (it.danger ? 'rgb(248 113 113 / 0.1)' : 'rgb(255 255 255 / 0.06)') : 'transparent',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{it.label}</div>
        )
      ))}
    </div>
  );
}

const MENU_FULL = [
  { label: 'Set password' },
  { label: 'Reset login' },
  { sep: true },
  { label: 'Remove from organisation', danger: true },
];
const MENU_SCOPED = [
  { label: 'Set password' },
  { label: 'Reset login', hover: true },
  { sep: true },
  { label: 'Remove from location', danger: true },
];

/* ── Page header + toolbar ──────────────────────────────────── */
function PageHead() {
  return (
    <div style={{ marginBottom: 20 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: T.fg, letterSpacing: '-0.01em' }}>Team</h1>
      <p style={{ margin: '5px 0 0', fontSize: 13.5, color: T.mutedFg }}>
        Invite staff, set permissions, and control location access.
      </p>
    </div>
  );
}

function Toolbar({ filterLabel = 'All roles' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', maxWidth: 320,
        height: 34, padding: '0 12px', borderRadius: T.radius,
        border: `1px solid ${T.input}`, background: 'rgb(255 255 255 / 0.03)', color: T.mutedFg,
      }}>
        <IconSearch />
        <span style={{ fontSize: 13 }}>Search team…</span>
      </div>
      <button style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        height: 34, padding: '0 12px', borderRadius: T.radius, cursor: 'pointer',
        border: `1px solid ${T.input}`, background: 'rgb(255 255 255 / 0.03)',
        color: T.fg, fontSize: 13, fontFamily: T.font,
      }}>
        {filterLabel}
        <span style={{ color: T.mutedFg, display: 'inline-flex' }}><IconChevron /></span>
      </button>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 13, color: T.mutedFg }}>4 members</span>
      <PrimaryBtn><IconPlus /> Invite team member</PrimaryBtn>
    </div>
  );
}

Object.assign(window, {
  T, ROLE_COLORS, MEMBERS,
  IconSearch, IconChevron, IconDots, IconPlus,
  Avatar, RoleBadge, SkillChip, MfaBadge, PermCount,
  PrimaryBtn, GhostIconBtn, EditBtn, OverflowMenu,
  MENU_FULL, MENU_SCOPED, PageHead, Toolbar,
});
