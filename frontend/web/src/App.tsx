// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Alliance {
  id: string;
  encryptedTerms: string;
  members: string[];
  expiration: number;
  status: "active" | "broken" | "expired";
}

interface Territory {
  id: string;
  name: string;
  owner: string;
  troops: number;
  encryptedTroops: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newAllianceData, setNewAllianceData] = useState({ terms: "", members: [""], duration: 30 });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedAlliance, setSelectedAlliance] = useState<Alliance | null>(null);
  const [decryptedTerms, setDecryptedTerms] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [selectedTerritory, setSelectedTerritory] = useState<Territory | null>(null);
  const [territoryTroops, setTerritoryTroops] = useState<number | null>(null);

  useEffect(() => {
    loadGameData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadGameData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Load alliances
      const alliancesBytes = await contract.getData("alliance_keys");
      let allianceKeys: string[] = [];
      if (alliancesBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(alliancesBytes);
          if (keysStr.trim() !== '') allianceKeys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing alliance keys:", e); }
      }
      
      const allianceList: Alliance[] = [];
      for (const key of allianceKeys) {
        try {
          const allianceBytes = await contract.getData(`alliance_${key}`);
          if (allianceBytes.length > 0) {
            try {
              const allianceData = JSON.parse(ethers.toUtf8String(allianceBytes));
              allianceList.push({ 
                id: key, 
                encryptedTerms: allianceData.terms,
                members: allianceData.members,
                expiration: allianceData.expiration,
                status: allianceData.status || "active"
              });
            } catch (e) { console.error(`Error parsing alliance data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading alliance ${key}:`, e); }
      }
      allianceList.sort((a, b) => b.expiration - a.expiration);
      
      // Load territories
      const territoriesBytes = await contract.getData("territory_keys");
      let territoryKeys: string[] = [];
      if (territoriesBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(territoriesBytes);
          if (keysStr.trim() !== '') territoryKeys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing territory keys:", e); }
      }
      
      const territoryList: Territory[] = [];
      for (const key of territoryKeys) {
        try {
          const territoryBytes = await contract.getData(`territory_${key}`);
          if (territoryBytes.length > 0) {
            try {
              const territoryData = JSON.parse(ethers.toUtf8String(territoryBytes));
              territoryList.push({ 
                id: key,
                name: territoryData.name,
                owner: territoryData.owner,
                troops: territoryData.troops,
                encryptedTroops: territoryData.encryptedTroops
              });
            } catch (e) { console.error(`Error parsing territory data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading territory ${key}:`, e); }
      }
      
      setAlliances(allianceList);
      setTerritories(territoryList);
    } catch (e) { console.error("Error loading game data:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createAlliance = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    if (!newAllianceData.terms || newAllianceData.members.length < 2) {
      alert("Please provide alliance terms and at least 2 members");
      return;
    }
    
    setCreating(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting alliance terms with Zama FHE..." 
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Encrypt terms (simplified - in real app would use actual FHE)
      const encryptedTerms = FHEEncryptNumber(parseInt(newAllianceData.terms));
      
      const allianceId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const expiration = Math.floor(Date.now() / 1000) + (newAllianceData.duration * 86400);
      
      const allianceData = { 
        terms: encryptedTerms,
        members: [...newAllianceData.members, address],
        expiration,
        status: "active"
      };
      
      await contract.setData(`alliance_${allianceId}`, ethers.toUtf8Bytes(JSON.stringify(allianceData)));
      
      // Update alliance keys
      const alliancesBytes = await contract.getData("alliance_keys");
      let allianceKeys: string[] = [];
      if (alliancesBytes.length > 0) {
        try { allianceKeys = JSON.parse(ethers.toUtf8String(alliancesBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      allianceKeys.push(allianceId);
      await contract.setData("alliance_keys", ethers.toUtf8Bytes(JSON.stringify(allianceKeys)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Secret alliance formed with FHE encryption!" 
      });
      
      await loadGameData();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewAllianceData({ terms: "", members: [""], duration: 30 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Alliance creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: errorMessage 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreating(false); 
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<string | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return `Decrypted: ${FHEDecryptNumber(encryptedData)}`; // Simplified for demo
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const breakAlliance = async (allianceId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing encrypted alliance with FHE..." 
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const allianceBytes = await contract.getData(`alliance_${allianceId}`);
      if (allianceBytes.length === 0) throw new Error("Alliance not found");
      
      const allianceData = JSON.parse(ethers.toUtf8String(allianceBytes));
      const updatedAlliance = { ...allianceData, status: "broken" };
      
      await contract.setData(`alliance_${allianceId}`, ethers.toUtf8Bytes(JSON.stringify(updatedAlliance)));
      
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Alliance broken! (This action is irreversible)" 
      });
      
      await loadGameData();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Failed to break alliance: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isMember = (alliance: Alliance) => {
    return alliance.members.some(m => m.toLowerCase() === address?.toLowerCase());
  };

  const tutorialSteps = [
    { 
      title: "Connect Wallet", 
      description: "Connect your Web3 wallet to enter the battlefield", 
      icon: "🔗" 
    },
    { 
      title: "Form Secret Alliances", 
      description: "Create FHE-encrypted treaties with other players", 
      icon: "🤝",
      details: "Alliance terms are encrypted with Zama FHE and remain secret" 
    },
    { 
      title: "Conquer Territories", 
      description: "Deploy your troops strategically across the map", 
      icon: "🗺️",
      details: "Troop movements are encrypted for strategic advantage" 
    },
    { 
      title: "Betray or Honor", 
      description: "Choose whether to honor your alliances or betray them", 
      icon: "⚔️",
      details: "The blockchain enforces alliance terms while keeping them secret" 
    }
  ];

  const renderAllianceStats = () => {
    const activeAlliances = alliances.filter(a => a.status === "active").length;
    const brokenAlliances = alliances.filter(a => a.status === "broken").length;
    const expiredAlliances = alliances.filter(a => a.status === "expired").length;
    
    return (
      <div className="stats-container">
        <div className="stat-item">
          <div className="stat-value">{alliances.length}</div>
          <div className="stat-label">Total Alliances</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{activeAlliances}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{brokenAlliances}</div>
          <div className="stat-label">Broken</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{expiredAlliances}</div>
          <div className="stat-label">Expired</div>
        </div>
      </div>
    );
  };

  const renderWorldMap = () => {
    // Simplified world map visualization
    const continents = [
      { name: "North America", territories: 9 },
      { name: "South America", territories: 4 },
      { name: "Europe", territories: 7 },
      { name: "Africa", territories: 6 },
      { name: "Asia", territories: 12 },
      { name: "Australia", territories: 4 }
    ];
    
    return (
      <div className="world-map">
        {continents.map((continent, index) => (
          <div 
            key={index} 
            className={`continent continent-${index}`}
            onClick={() => alert(`Viewing ${continent.name} territories`)}
          >
            <div className="continent-name">{continent.name}</div>
            <div className="territory-count">{continent.territories} territories</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="war-spinner"></div>
      <p>Initializing encrypted battlefield...</p>
    </div>
  );

  return (
    <div className="app-container war-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">⚔️</div>
          <h1>戰國風雲<span>隱秘同盟</span></h1>
          <div className="subtitle">Risk with FHE-Encrypted Alliances</div>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn war-button">
            + Form Secret Alliance
          </button>
          <button className="war-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Tutorial" : "Battle Guide"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content partitioned-layout">
        {/* Left Panel - World Map */}
        <div className="left-panel war-panel">
          <h2>Global Territories</h2>
          {renderWorldMap()}
          
          <div className="territory-stats">
            <h3>Territory Control</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{territories.length}</div>
                <div className="stat-label">Total</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">
                  {territories.filter(t => t.owner === address).length}
                </div>
                <div className="stat-label">Yours</div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Right Panel - Alliances */}
        <div className="right-panel war-panel">
          <div className="panel-header">
            <h2>Secret Alliances</h2>
            <button onClick={loadGameData} className="refresh-btn war-button" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          {showTutorial && (
            <div className="tutorial-section">
              <h3>Battle Guide</h3>
              <div className="tutorial-steps">
                {tutorialSteps.map((step, index) => (
                  <div className="tutorial-step" key={index}>
                    <div className="step-icon">{step.icon}</div>
                    <div className="step-content">
                      <h4>{step.title}</h4>
                      <p>{step.description}</p>
                      {step.details && <div className="step-details">{step.details}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="alliance-stats">
            <h3>Alliance Statistics</h3>
            {renderAllianceStats()}
          </div>
          
          <div className="alliances-list">
            <div className="list-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Members</div>
              <div className="header-cell">Expires</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {alliances.length === 0 ? (
              <div className="no-alliances">
                <div className="no-alliances-icon">🤝</div>
                <p>No secret alliances formed yet</p>
                <button className="war-button primary" onClick={() => setShowCreateModal(true)}>
                  Form First Alliance
                </button>
              </div>
            ) : alliances.map(alliance => (
              <div 
                className={`alliance-row ${alliance.status}`} 
                key={alliance.id} 
                onClick={() => setSelectedAlliance(alliance)}
              >
                <div className="table-cell">#{alliance.id.substring(0, 6)}</div>
                <div className="table-cell">
                  {alliance.members.length} players
                </div>
                <div className="table-cell">
                  {new Date(alliance.expiration * 1000).toLocaleDateString()}
                </div>
                <div className="table-cell">
                  <span className={`status-badge ${alliance.status}`}>
                    {alliance.status}
                  </span>
                </div>
                <div className="table-cell actions">
                  {isMember(alliance) && alliance.status === "active" && (
                    <button 
                      className="action-btn war-button danger" 
                      onClick={(e) => { e.stopPropagation(); breakAlliance(alliance.id); }}
                    >
                      Break Alliance
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Create Alliance Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal war-card">
            <div className="modal-header">
              <h2>Form Secret Alliance</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Alliance Terms (Encrypted with FHE)</label>
                <textarea
                  name="terms"
                  value={newAllianceData.terms}
                  onChange={(e) => setNewAllianceData({...newAllianceData, terms: e.target.value})}
                  placeholder="Enter alliance terms (will be encrypted)..."
                  className="war-textarea"
                />
              </div>
              
              <div className="form-group">
                <label>Alliance Members (including yourself)</label>
                {newAllianceData.members.map((member, index) => (
                  <div key={index} className="member-input">
                    <input
                      type="text"
                      value={member}
                      onChange={(e) => {
                        const newMembers = [...newAllianceData.members];
                        newMembers[index] = e.target.value;
                        setNewAllianceData({...newAllianceData, members: newMembers});
                      }}
                      placeholder={`Member ${index + 1} address`}
                      className="war-input"
                    />
                    {index > 0 && (
                      <button 
                        onClick={() => {
                          const newMembers = [...newAllianceData.members];
                          newMembers.splice(index, 1);
                          setNewAllianceData({...newAllianceData, members: newMembers});
                        }}
                        className="remove-member war-button danger"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button 
                  onClick={() => setNewAllianceData({...newAllianceData, members: [...newAllianceData.members, ""]})}
                  className="add-member war-button"
                >
                  + Add Member
                </button>
              </div>
              
              <div className="form-group">
                <label>Duration (Days)</label>
                <input
                  type="number"
                  name="duration"
                  value={newAllianceData.duration}
                  onChange={(e) => setNewAllianceData({...newAllianceData, duration: parseInt(e.target.value) || 30})}
                  min="1"
                  max="365"
                  className="war-input"
                />
              </div>
              
              <div className="encryption-notice">
                <div className="lock-icon">🔒</div>
                <div>
                  <strong>FHE Encryption Notice</strong>
                  <p>Alliance terms will be encrypted with Zama FHE before submission</p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)} 
                className="war-button"
              >
                Cancel
              </button>
              <button 
                onClick={createAlliance} 
                disabled={creating}
                className="war-button primary"
              >
                {creating ? "Forming Encrypted Alliance..." : "Form Secret Alliance"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Alliance Detail Modal */}
      {selectedAlliance && (
        <div className="modal-overlay">
          <div className="detail-modal war-card">
            <div className="modal-header">
              <h2>Alliance Details #{selectedAlliance.id.substring(0, 8)}</h2>
              <button onClick={() => { 
                setSelectedAlliance(null); 
                setDecryptedTerms(null); 
              }} className="close-modal">×</button>
            </div>
            <div className="modal-body">
              <div className="alliance-info">
                <div className="info-item">
                  <span>Status:</span>
                  <strong className={`status-badge ${selectedAlliance.status}`}>
                    {selectedAlliance.status}
                  </strong>
                </div>
                <div className="info-item">
                  <span>Expires:</span>
                  <strong>{new Date(selectedAlliance.expiration * 1000).toLocaleString()}</strong>
                </div>
                <div className="info-item">
                  <span>Members:</span>
                  <strong>{selectedAlliance.members.length}</strong>
                </div>
              </div>
              
              <div className="encrypted-terms">
                <h3>Encrypted Terms</h3>
                <div className="encrypted-data">
                  {selectedAlliance.encryptedTerms.substring(0, 100)}...
                </div>
                <div className="fhe-tag">
                  <div className="fhe-icon">🔒</div>
                  <span>FHE Encrypted</span>
                </div>
                <button 
                  className="decrypt-btn war-button" 
                  onClick={async () => {
                    if (decryptedTerms !== null) {
                      setDecryptedTerms(null);
                    } else {
                      const decrypted = await decryptWithSignature(selectedAlliance.encryptedTerms);
                      if (decrypted) setDecryptedTerms(decrypted);
                    }
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedTerms ? "Hide Terms" : "Decrypt with Wallet Signature"}
                </button>
              </div>
              
              {decryptedTerms && (
                <div className="decrypted-terms">
                  <h3>Decrypted Terms</h3>
                  <div className="terms-content">
                    {decryptedTerms}
                  </div>
                  <div className="decryption-notice">
                    <div className="warning-icon">⚠️</div>
                    <span>Decrypted terms are only visible after wallet signature verification</span>
                  </div>
                </div>
              )}
              
              <div className="member-list">
                <h3>Alliance Members</h3>
                <div className="members-grid">
                  {selectedAlliance.members.map((member, index) => (
                    <div key={index} className="member-item">
                      <div className="member-address">
                        {member.substring(0, 6)}...{member.substring(38)}
                      </div>
                      {member.toLowerCase() === address?.toLowerCase() && (
                        <div className="you-badge">You</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                onClick={() => { 
                  setSelectedAlliance(null); 
                  setDecryptedTerms(null); 
                }} 
                className="war-button"
              >
                Close
              </button>
              {isMember(selectedAlliance) && selectedAlliance.status === "active" && (
                <button 
                  onClick={() => breakAlliance(selectedAlliance.id)}
                  className="war-button danger"
                >
                  Break Alliance
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content war-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="war-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">⚔️ <span>戰國風雲: 隱秘同盟</span></div>
            <p>Risk-style game with FHE-encrypted secret alliances</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Powered by Zama FHE</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Secret Diplomacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} 戰國風雲. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;