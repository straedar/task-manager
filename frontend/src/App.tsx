import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { DialogProvider } from "./context/DialogContext";
import { LoginPage } from "./pages/LoginPage";
import { HubPage } from "./pages/HubPage";
import { HomePage } from "./pages/HomePage";
import { AdminPage } from "./pages/AdminPage";
import { IdeasPage } from "./pages/IdeasPage";
import { PlannerPage } from "./pages/PlannerPage";
import { StockmapPage } from "./pages/StockmapPage";
import { ComingSoonPage } from "./pages/ComingSoonPage";
import { ReferencePage } from "./pages/ReferencePage";
import { NewsFeedPage } from "./pages/NewsFeedPage";
import { NewsDetailPage } from "./pages/NewsDetailPage";
import { NewsEditorPage } from "./pages/NewsEditorPage";
import { NotificationSettingsPage } from "./pages/NotificationSettingsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { FeedbackDetailPage } from "./pages/FeedbackDetailPage";
import { FeedbackEditorPage } from "./pages/FeedbackEditorPage";
import { StructurePage } from "./pages/StructurePage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { ChecklistDetailPage } from "./pages/ChecklistDetailPage";

export default function App() {
  return (
    <ThemeProvider>
      <DialogProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<Navigate to="/login" replace />} />

              <Route path="/" element={<HubPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/profile/feedback" element={<FeedbackPage />} />
              <Route path="/profile/feedback/new" element={<FeedbackEditorPage />} />
              <Route path="/profile/feedback/:id/edit" element={<FeedbackEditorPage />} />
              <Route path="/profile/feedback/:id" element={<FeedbackDetailPage />} />
              <Route path="/profile/:userId/feedback" element={<FeedbackPage />} />
              <Route path="/profile/:userId" element={<ProfilePage />} />
              <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
              <Route path="/administration" element={<AdminPage />} />
              <Route path="/structure" element={<StructurePage />} />
              <Route path="/stockmap" element={<StockmapPage />} />
              <Route path="/reference" element={<ReferencePage />} />
              <Route path="/news" element={<NewsFeedPage />} />
              <Route path="/news/new" element={<NewsEditorPage />} />
              <Route path="/news/:id/edit" element={<NewsEditorPage />} />
              <Route path="/news/:id" element={<NewsDetailPage />} />
              <Route path="/apps/:appId" element={<ComingSoonPage />} />
              <Route path="/apps/reference" element={<Navigate to="/reference" replace />} />
              <Route path="/apps/news" element={<Navigate to="/news" replace />} />

              <Route path="/tasks" element={<HomePage />} />
              <Route path="/tasks/completed" element={<HomePage />} />
              <Route path="/tasks/ideas" element={<IdeasPage />} />
              <Route path="/tasks/planner" element={<PlannerPage />} />
              <Route path="/tasks/t/:id" element={<TaskDetailPage />} />
              <Route path="/tasks/c/:id" element={<ChecklistDetailPage />} />

              {/* Legacy redirects */}
              <Route path="/completed" element={<Navigate to="/tasks/completed" replace />} />
              <Route path="/ideas" element={<Navigate to="/tasks/ideas" replace />} />
              <Route path="/planner" element={<Navigate to="/tasks/planner" replace />} />
              <Route path="/admin" element={<Navigate to="/administration" replace />} />
              <Route path="/tasks/admin" element={<Navigate to="/administration" replace />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </DialogProvider>
    </ThemeProvider>
  );
}

