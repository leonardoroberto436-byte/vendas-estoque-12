import { Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import PointOfSale from "@/pages/PointOfSale";
import SalesHistory from "@/pages/SalesHistory";
import Products from "@/pages/Products";
import Stock from "@/pages/Stock";
import Alerts from "@/pages/Alerts";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/vender" element={<PointOfSale />} />
      <Route path="/vendas" element={<SalesHistory />} />
      <Route path="/produtos" element={<Products />} />
      <Route path="/estoque" element={<Stock />} />
      <Route path="/alertas" element={<Alerts />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
