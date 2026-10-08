import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWeb3 } from "@/contexts/web3-context";
import { Copy, LogOut, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/** Two hues derived from the address → a stable, distinct gradient. */
function identicon(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) {
    h = (h * 31 + address.charCodeAt(i)) >>> 0;
  }
  const a = h % 360;
  const b = (a + 40 + ((h >>> 9) % 140)) % 360;
  return `linear-gradient(135deg, hsl(${a} 75% 55%), hsl(${b} 70% 45%))`;
}

export function WalletButton() {
  const { wallet, connectWallet, disconnectWallet, refreshBalance } = useWeb3();
  const { toast } = useToast();

  const handleConnect = () => {
    void connectWallet();
  };

  const handleDisconnect = () => {
    disconnectWallet();
  };

  const handleCopyAddress = async () => {
    if (wallet.address) {
      await navigator.clipboard.writeText(wallet.address);
      toast({
        title: "Address copied",
        description: "Wallet address copied to clipboard",
      });
    }
  };

  const handleRefreshBalance = async () => {
    if (refreshBalance) {
      await refreshBalance();
      toast({
        title: "Balance refreshed",
        description: "Wallet balance has been updated",
      });
    }
  };

  if (!wallet.isConnected || !wallet.address) {
    return (
      <Button
        onClick={() => {
          void handleConnect();
        }}
        variant="default"
      >
        Connect Wallet
      </Button>
    );
  }

  const balanceNumber = Number(wallet.balance || 0);
  const balanceFull = balanceNumber.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // 5382.15 → "5.38K"; small balances keep two decimals.
  const balanceShort =
    balanceNumber >= 1000
      ? new Intl.NumberFormat(undefined, {
          notation: "compact",
          maximumFractionDigits: 2,
        }).format(balanceNumber)
      : balanceNumber.toFixed(2);
  const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;

  return (
    <DropdownMenu>
      {/*
        Compact trigger, as in the Arc version: identicon + balance (~110px).
        The identicon IS the address (derived from it, so it changes the
        instant you switch accounts) and the balance is what people glance up
        for. The XLM icon, separator and truncated address made the pill
        ~300px and pushed the nav off-centre; the address lives in the
        tooltip, the accessible name and the menu below.
      */}
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          title={wallet.address}
          aria-label={`Wallet ${short}, ${balanceFull} XLM`}
          className="flex items-center gap-2 h-9 rounded-full px-2 sm:pl-1.5 sm:pr-3 bg-muted/50 hover:bg-muted/70 border border-border/40"
        >
          {/* Identicon generated locally from the address: no third-party
              image request (which also leaked the address), and it always
              renders. Changes the instant you switch accounts. */}
          <span
            aria-hidden="true"
            className="w-6 h-6 rounded-full shrink-0 ring-1 ring-border/60"
            style={{ background: identicon(wallet.address) }}
          />
          <span className="hidden sm:inline text-sm font-medium tabular-nums">
            {balanceShort}{" "}
            <span className="text-muted-foreground font-normal">XLM</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5 text-sm">
          <div className="font-medium">Connected Wallet</div>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {wallet.address}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Balance: {balanceFull} XLM
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void handleCopyAddress();
          }}
        >
          <Copy className="mr-2 h-4 w-4" />
          Copy Address
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void handleRefreshBalance();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh Balance
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleDisconnect}
          className="text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
