import { Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import PointOfSale from "@/pages/PointOfSale";
import SalesHistory from "@/pages/SalesHistory";
import Products from "@/pages/Products";
import Stock from "@/pages/Stock";
import Alerts from "@/pages/Alerts";
import Returns from "@/pages/Returns";
import MonthlyReportPage from "@/pages/MonthlyReport";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import { ForgotPassword, ResetPassword } from "@/pages/PasswordRecovery";
import Admin from "@/pages/Admin";
import Platform from "@/pages/Platform";
import Profile from "@/pages/Profile";
import Company from "@/pages/Company";
import RequireAuth from "@/components/RequireAuth";

/** Tenant-scoped page: any signed-in member of a company. */
function Shop({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Signup />} />
      <Route path="/esqueci-senha" element={<ForgotPassword />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />

      {/* company workspace */}
      <Route path="/" element={<Shop><Home /></Shop>} />
      <Route path="/vender" element={<Shop><PointOfSale /></Shop>} />
      <Route path="/vendas" element={<Shop><SalesHistory /></Shop>} />
      <Route path="/devolucoes" element={<Shop><Returns /></Shop>} />
      <Route path="/produtos" element={<Shop><Products /></Shop>} />
      <Route path="/estoque" element={<Shop><Stock /></Shop>} />
      <Route path="/alertas" element={<Shop><Alerts /></Shop>} />
      <Route path="/relatorio" element={<Shop><MonthlyReportPage /></Shop>} />
      <Route path="/perfil" element={<Shop><Profile /></Shop>} />

      {/* company admin only */}
      <Route
        path="/empresa"
        element={
          <RequireAuth adminOnly>
            <Company />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth adminOnly>
            <Admin />
          </RequireAuth>
        }
      />

      {/* SaaS owner only */}
      <Route
        path="/plataforma"
        element={
          <RequireAuth platformOnly>
            <Platform />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Shop><Home /></Shop>} />
    </Routes>
  );
}
