import { Suspense, useRef, useState } from "react";
import { Chat } from "./chat";
import { ThemeToggle } from "./themeToggle";
import { Admin } from "./admin";
import {
  Button
} from "@cloudflare/kumo";
import { Toasty } from "@cloudflare/kumo/components/toast";
import {
  ChatCircleDotsIcon,
  ChartBarIcon,
  PlusIcon
} from "@phosphor-icons/react";

interface ChatHandle {
  clearHistory: () => void;
}

export default function App() {
  const [mode, setMode] = useState<'chat' | 'admin'>('chat');
  const chatRef = useRef<ChatHandle | null>(null);

  const handleNewChat = () => {
    if (chatRef.current) {
      chatRef.current.clearHistory();
    }
  }
  return (
    <Toasty>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen text-kumo-inactive">
            Loading...
          </div>
        }
      >
        <div className="h-screen flex flex-col">
          {/* Nav Bar */}
          <nav className="flex items-center justify-between p-4 border-b border-kumo-line bg-kumo-surface">
            <div className="flex items-center gap-2">
              <div className="text-lg font-bold">Cloudflare Agent</div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              {mode === 'chat' && (
                <Button
                  variant="secondary"
                  icon={<PlusIcon size={16} />}
                  onClick={handleNewChat}
                  title="Start a new chat"
                >
                  New Chat
                </Button>
              )}
              <Button
                variant={mode === 'chat' ? 'primary' : 'secondary'}
                icon={<ChatCircleDotsIcon size={16} />}
                onClick={() => setMode('chat')}
              >
                Chat
              </Button>
              <Button
                variant={mode === 'admin' ? 'primary' : 'secondary'}
                icon={<ChartBarIcon size={16} />}
                onClick={() => setMode('admin')}
              >
                Dashboard
              </Button>
            </div>
          </nav>
          
          {/* Main Content */}
          <div className="flex-1 overflow-hidden">
            {mode === 'chat' ? (
              <Chat 
                ref={chatRef}
              />
            ) : (
              <Admin />
            )}
          </div>
        </div>
      </Suspense>
    </Toasty>
  );
}
