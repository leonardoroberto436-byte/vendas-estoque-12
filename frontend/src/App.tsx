import { Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import PointOfSale from "@/pages/PointOfSale";
import SalesHistory from "@/pages/SalesHistory";
import Products from "@/pages/Products";
import Stock from "@/pages/Stock";
import Alerts from "@/pages/Alerts";
import MonthlyReportPage from "@/pages/MonthlyReport";
import Login from "@/pages/Login";
import Admin from "@/pages/Admin";
import Profile from "@/pages/Profile";
import RequireAuth from "@/components/RequireAuth";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Home />
          </RequireAuth>
        }
      />
      <Route
        path="/vender"
        element={
          <RequireAuth>
            <PointOfSale />
          </RequireAuth>
        }
      />
      <Route
        path="/vendas"
        element={
          <RequireAuth>
            <SalesHistory />
          </RequireAuth>
        }
      />
      <Route
        path="/produtos"
        element={
          <RequireAuth>
            <Products />
          </RequireAuth>
        }
      />
      <Route
        path="/estoque"
        element={
          <RequireAuth>
            <Stock />
          </RequireAuth>
        }
      />
      <Route
        path="/alertas"
        element={
          <RequireAuth>
            <Alerts />
          </RequireAuth>
        }
      />
      <Route
        path="/relatorio"
        element={
          <RequireAuth>
            <MonthlyReportPage />
          </RequireAuth>
        }
      />
      <Route
        path="/perfil"
        element={
          <RequireAuth>
            <Profile />
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
      <Route
        path="*"
        element={
          <RequireAuth>
            <Home />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
