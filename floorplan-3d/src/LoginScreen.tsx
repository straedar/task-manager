export function LoginScreen() {
  const openTaskMasterLogin = () => {
    const target = "/login";
    if (window.top && window.top !== window) {
      window.top.location.href = target;
      return;
    }
    window.location.href = target;
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <p className="login-brand">3Д карта склада</p>
        <h1 className="login-title">Вход через TaskMaster</h1>
        <p className="login-sub">
          Войдите в TaskMaster — карта использует ту же сессию и ту же базу, что
          и обычная карта склада.
        </p>
        <button type="button" className="btn primary" onClick={openTaskMasterLogin}>
          Войти в TaskMaster
        </button>
      </div>
    </div>
  );
}
