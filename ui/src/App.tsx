import { AppTitlebar } from "./layout/AppTitlebar";
import { ChatPage } from "./pages/ChatPage";

function App() {
  return (
    <div className="app-shell">
      <AppTitlebar />
      <div className="workspace">
        <ChatPage />
      </div>
    </div>
  );
}

export default App;
