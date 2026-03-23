export default function SettingsPage() {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Platform configuration and preferences</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Execution Defaults</h2>
          </div>
          <div className="card-body">
            <SettingRow label="Default Backend" value="FDM" />
            <SettingRow label="Execution Mode" value="strict" />
            <SettingRow label="Precision" value="double" />
            <SettingRow label="Default Timestep" value="1×10⁻¹³ s" />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">GPU Configuration</h2>
          </div>
          <div className="card-body">
            <SettingRow label="CUDA Device" value="Not detected" muted />
            <SettingRow label="CUDA Toolkit" value="—" muted />
            <SettingRow label="GPU Backend Status" value="Phase 2" muted />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Appearance</h2>
          </div>
          <div className="card-body">
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              Use the sun/moon icon in the top bar to toggle between dark and light themes.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function SettingRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'var(--sp-3) 0',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: muted ? 'var(--text-muted)' : 'var(--text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}
