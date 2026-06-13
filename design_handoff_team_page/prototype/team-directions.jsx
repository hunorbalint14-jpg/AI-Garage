// team-directions.jsx — three Team-page directions mounted on the design canvas.
// Relies on globals from team-shared.jsx (T, MEMBERS, primitives).

const AW = 1040; // shared artboard width

/* Right-side action cluster — consistent anchor on every row.
   Primary "Edit" stays visible where it applies; everything else lives
   behind the ⋯ overflow menu. Current user has no destructive actions. */
function Actions({ member, openMenu }) {
  if (member.you) {
    return <span style={{ fontSize: 12, color: T.mutedFg, opacity: 0.7 }}>—</span>;
  }
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {member.editable && <EditBtn />}
      <GhostIconBtn active={openMenu} />
      {openMenu && <OverflowMenu items={member.access === 'full' ? MENU_FULL : MENU_SCOPED} />}
    </div>
  );
}

function AccessCell({ member, wrap }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 6 }}>
      {member.access === 'full'
        ? <span style={{ fontSize: 12.5, color: 'oklch(0.82 0 0)' }}>Full access</span>
        : <PermCount n={member.perms} />}
      {member.skills.map((s) => <SkillChip key={s.label} label={s.label} tone={s.tone} />)}
      <MfaBadge on={member.mfa} />
    </div>
  );
}

/* Identity block: avatar + name/email/scope. `size` tunes density. */
function Identity({ member, avatarSize = 38, showScope = true }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <Avatar member={member} size={avatarSize} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: T.fg, whiteSpace: 'nowrap' }}>{member.name}</span>
          {member.you && <span style={{ fontSize: 11.5, color: T.mutedFg }}>(you)</span>}
          {member.name2 && <span style={{ fontSize: 11.5, color: T.mutedFg }}>{member.name2}</span>}
        </div>
        <div style={{ fontSize: 12.5, color: T.mutedFg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.email}</div>
        {showScope && <div style={{ fontSize: 11.5, color: 'oklch(0.6 0 0)', marginTop: 1 }}>{member.scope}</div>}
      </div>
    </div>
  );
}

/* ════════════════════════════ A · Aligned table ═══════════════════════════ */
function DirectionTable() {
  const cols = 'minmax(0, 1.5fr) 128px minmax(0, 1.3fr) 110px';
  return (
    <div style={{ background: T.bg, fontFamily: T.font, padding: 32, width: AW, minHeight: '100%', boxSizing: 'border-box', color: T.fg }}>
      <PageHead />
      <Toolbar />
      <div style={{ border: `1px solid ${T.borderStrong}`, borderRadius: 12, overflow: 'hidden', background: T.card }}>
        {/* header */}
        <div style={{
          display: 'grid', gridTemplateColumns: cols, gap: 16, alignItems: 'center',
          padding: '11px 18px', background: 'rgb(255 255 255 / 0.025)',
          borderBottom: `1px solid ${T.border}`,
          fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.mutedFg,
        }}>
          <span>Staff member</span>
          <span>Role</span>
          <span>Access &amp; security</span>
          <span style={{ textAlign: 'right' }}>Actions</span>
        </div>
        {MEMBERS.map((m, i) => (
          <div key={m.id} style={{
            display: 'grid', gridTemplateColumns: cols, gap: 16, alignItems: 'center',
            padding: '15px 18px',
            borderBottom: i < MEMBERS.length - 1 ? `1px solid ${T.border}` : 'none',
            background: m.id === 'adam-t' ? 'rgb(255 255 255 / 0.02)' : 'transparent',
          }}>
            <Identity member={m} />
            <div><RoleBadge role={m.role} /></div>
            <AccessCell member={m} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Actions member={m} openMenu={m.id === 'adam-t'} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════ B · Card rows ═══════════════════════════════ */
function DirectionCards() {
  return (
    <div style={{ background: T.bg, fontFamily: T.font, padding: 32, width: AW, minHeight: '100%', boxSizing: 'border-box', color: T.fg }}>
      <PageHead />
      <Toolbar />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {MEMBERS.map((m) => (
          <div key={m.id} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '16px 18px', borderRadius: 12,
            border: `1px solid ${T.borderStrong}`, background: T.card,
          }}>
            <Avatar member={m} size={46} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15.5, fontWeight: 600, color: T.fg }}>{m.name}</span>
                {m.you && <span style={{ fontSize: 12, color: T.mutedFg }}>(you)</span>}
                {m.name2 && <span style={{ fontSize: 12, color: T.mutedFg }}>{m.name2}</span>}
                <RoleBadge role={m.role} />
              </div>
              <div style={{ fontSize: 12.5, color: T.mutedFg, marginTop: 3 }}>
                {m.email} &nbsp;·&nbsp; {m.scope}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 6, marginTop: 10 }}>
                {m.access === 'full'
                  ? <span style={{ fontSize: 12, color: 'oklch(0.82 0 0)' }}>Full access</span>
                  : <PermCount n={m.perms} />}
                {m.skills.map((s) => <SkillChip key={s.label} label={s.label} tone={s.tone} />)}
                <MfaBadge on={m.mfa} />
              </div>
            </div>
            <div style={{ alignSelf: 'flex-start' }}>
              <Actions member={m} openMenu={false} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════ C · Grouped by access ═══════════════════════ */
function GroupedSection({ title, count, members, cols }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px 9px' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: T.mutedFg }}>{title}</span>
        <span style={{
          fontSize: 10.5, fontWeight: 600, color: T.mutedFg,
          padding: '1px 7px', borderRadius: 20, background: 'rgb(255 255 255 / 0.06)',
        }}>{count}</span>
        <span style={{ flex: 1, height: 1, background: T.border }} />
      </div>
      <div style={{ border: `1px solid ${T.borderStrong}`, borderRadius: 12, overflow: 'hidden', background: T.card }}>
        {members.map((m, i) => (
          <div key={m.id} style={{
            display: 'grid', gridTemplateColumns: cols, gap: 16, alignItems: 'center',
            padding: '12px 16px',
            borderBottom: i < members.length - 1 ? `1px solid ${T.border}` : 'none',
          }}>
            <Identity member={m} avatarSize={32} showScope={false} />
            <div><RoleBadge role={m.role} /></div>
            <AccessCell member={m} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Actions member={m} openMenu={false} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DirectionGrouped() {
  const cols = 'minmax(0, 1.5fr) 128px minmax(0, 1.3fr) 110px';
  const org = MEMBERS.filter((m) => m.access === 'full');
  const garage = MEMBERS.filter((m) => m.scope === 'test Garage');
  const colindale = MEMBERS.filter((m) => m.scope === 'Colindale');
  return (
    <div style={{ background: T.bg, fontFamily: T.font, padding: 32, width: AW, minHeight: '100%', boxSizing: 'border-box', color: T.fg }}>
      <PageHead />
      <Toolbar filterLabel="By location" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <GroupedSection title="Organisation-wide" count="2 members" members={org} cols={cols} />
        <GroupedSection title="test Garage" count="1 member" members={garage} cols={cols} />
        <GroupedSection title="Colindale" count="1 member" members={colindale} cols={cols} />
      </div>
    </div>
  );
}

/* ════════════════════════════ Canvas ══════════════════════════════════════ */
function TeamCanvas() {
  return (
    <DesignCanvas>
      <DCSection id="team" title="Team page — redesign directions" subtitle="AI Garage · dark theme · staff management">
        <DCArtboard id="table" label="A · Aligned table" width={AW} height={556}>
          <DirectionTable />
        </DCArtboard>
        <DCArtboard id="cards" label="B · Card rows" width={AW} height={626}>
          <DirectionCards />
        </DCArtboard>
        <DCArtboard id="grouped" label="C · Grouped by access" width={AW} height={560}>
          <DirectionGrouped />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<TeamCanvas />);
