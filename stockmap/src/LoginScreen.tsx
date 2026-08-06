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
        <p className="login-brand">Карта склада</p>
        <h1 className="login-title">Вход через TaskMaster</h1>
        <p className="login-sub">
          Отдельный логин для карты склада больше не нужен. Войдите в основной
          аккаунт TaskMaster, и роль применится здесь автоматически.
        </p>

        <button
          type="button"
          className="btn primary login-submit"
          onClick={openTaskMasterLogin}
        >
          Войти в TaskMaster
        </button>
      </div>
    </div>
  );
}
