import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AccountContextType {
  selectedAccountId: string | null;
  setSelectedAccountId: (accountId: string | null) => void;
}

const AccountContext = createContext<AccountContextType | undefined>(undefined);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(() => {
    // Load from localStorage on mount
    const saved = localStorage.getItem('selectedAccountId');
    return saved || null;
  });

  const setSelectedAccountId = (accountId: string | null) => {
    setSelectedAccountIdState(accountId);
    if (accountId) {
      localStorage.setItem('selectedAccountId', accountId);
    } else {
      localStorage.removeItem('selectedAccountId');
    }
  };

  return (
    <AccountContext.Provider value={{ selectedAccountId, setSelectedAccountId }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}
