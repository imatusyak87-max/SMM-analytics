import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

function Placeholder({ label }: { label: string }) {
  return <div>{label}</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Placeholder label="login" />} />
        <Route path="/" element={<Placeholder label="overview" />} />
        <Route path="/accounts/:id" element={<Placeholder label="detail" />} />
        <Route path="/compare" element={<Placeholder label="compare" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
