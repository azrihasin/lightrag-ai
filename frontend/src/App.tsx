import { useEffect, useState } from "react"
import "./App.css"
import ChatPage from "./pages/ChatPage"
import AllChartsPage from "./pages/AllChartsPage"
import { TooltipProvider } from "./components/ui/tooltip"

type Tab = "chat" | "all-charts"

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "all-charts", label: "All Charts" },
]

function isTab(value: string): value is Tab {
  return tabs.some((tab) => tab.id === value)
}

function getTabFromHash(): Tab {
  if (typeof window === "undefined") {
    return "chat"
  }

  const hash = window.location.hash.replace("#", "")

  return isTab(hash) ? hash : "chat"
}

function App() {
  const [tab, setTab] = useState<Tab>(() => getTabFromHash())

  useEffect(() => {
    const syncTabFromHash = () => {
      setTab(getTabFromHash())
    }

    syncTabFromHash()
    window.addEventListener("hashchange", syncTabFromHash)

    return () => {
      window.removeEventListener("hashchange", syncTabFromHash)
    }
  }, [])

  const handleTabChange = (nextTab: Tab) => {
    setTab(nextTab)
    window.location.hash = nextTab
  }

  return (
    <TooltipProvider>
      <div className="fixed inset-0 w-screen h-screen bg-background flex flex-col">
        <nav className="flex border-b border-border px-4 gap-1 shrink-0">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleTabChange(item.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === item.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-h-0">
          {tab === "chat" && <ChatPage />}
          {tab === "all-charts" && <AllChartsPage />}
        </div>
      </div>
    </TooltipProvider>
  )
}

export default App
