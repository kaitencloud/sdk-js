import { useEffect, useState } from "react";

import { ComponentsPage } from "./components-page.tsx";
import { HeadlessPage } from "./headless-page.tsx";

type Page = "components" | "headless";

function currentPage(): Page {
  return window.location.hash === "#headless" ? "headless" : "components";
}

export function App() {
  const [page, setPage] = useState<Page>(currentPage);

  useEffect(() => {
    const onHashChange = () => setPage(currentPage());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <main className="shell">
      <nav className="tabs" aria-label="Examples">
        <a href="#components" aria-current={page === "components" ? "page" : undefined}>
          Kaiten's components
        </a>
        <a href="#headless" aria-current={page === "headless" ? "page" : undefined}>
          Your own UI
        </a>
      </nav>
      {page === "components" ? <ComponentsPage /> : <HeadlessPage />}
    </main>
  );
}
