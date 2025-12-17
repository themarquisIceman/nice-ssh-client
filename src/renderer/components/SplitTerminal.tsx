import React, { useState, useRef, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import Terminal, { TerminalRef } from './Terminal';
import './SplitTerminal.css';

interface Pane {
  id: string;
  connectionId: string;
  initialPath?: string;
}

interface SplitNode {
  type: 'leaf' | 'horizontal' | 'vertical';
  paneId?: string; // Reference to pane by ID instead of embedding pane object
  children?: SplitNode[];
  sizes?: number[];
}

interface SplitTerminalProps {
  connectionId: string;
  initialPath?: string;
}

export interface SplitTerminalRef {
  sendCommand: (command: string) => void;
}

let paneCounter = 0;

const SplitTerminal = forwardRef<SplitTerminalRef, SplitTerminalProps>(function SplitTerminal({ connectionId, initialPath }, ref) {
  // Keep panes in a separate stable array - this prevents remounting
  const [panes, setPanes] = useState<Pane[]>(() => {
    const initialPane = { id: `pane-${paneCounter++}`, connectionId, initialPath };
    return [initialPane];
  });

  const [root, setRoot] = useState<SplitNode>(() => ({
    type: 'leaf',
    paneId: panes[0]?.id,
  }));

  const [activePane, setActivePane] = useState<string>(panes[0]?.id || '');
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRefs = useRef<Map<string, TerminalRef>>(new Map());
  const [resizing, setResizing] = useState<{ node: SplitNode; index: number } | null>(null);

  // Expose sendCommand method via ref - sends to first available terminal
  useImperativeHandle(ref, () => ({
    sendCommand: (command: string) => {
      // Try active pane first, then first pane
      const activePaneRef = terminalRefs.current.get(activePane);
      if (activePaneRef) {
        activePaneRef.sendCommand(command);
        return;
      }
      // Fallback to first pane
      const firstPaneId = panes[0]?.id;
      if (firstPaneId) {
        const firstRef = terminalRefs.current.get(firstPaneId);
        firstRef?.sendCommand(command);
      }
    }
  }), [activePane, panes]);

  // Create a new pane and add to the panes array
  const createPane = useCallback((): Pane => {
    const newPane = { id: `pane-${paneCounter++}`, connectionId };
    setPanes(prev => [...prev, newPane]);
    return newPane;
  }, [connectionId]);

  // Find and split a pane
  const splitPane = useCallback((paneId: string, direction: 'horizontal' | 'vertical') => {
    const newPane = createPane();

    const findAndSplit = (node: SplitNode): SplitNode => {
      if (node.type === 'leaf' && node.paneId === paneId) {
        return {
          type: direction,
          children: [
            { type: 'leaf', paneId: node.paneId },
            { type: 'leaf', paneId: newPane.id },
          ],
          sizes: [50, 50],
        };
      }

      if (node.children) {
        return {
          ...node,
          children: node.children.map(child => findAndSplit(child)),
        };
      }

      return node;
    };

    setRoot(prev => findAndSplit(prev));
    setActivePane(newPane.id);
  }, [createPane]);

  // Close a pane
  const closePane = useCallback((paneId: string) => {
    const countPanes = (node: SplitNode): number => {
      if (node.type === 'leaf') return 1;
      return (node.children || []).reduce((sum, child) => sum + countPanes(child), 0);
    };

    // Don't close the last pane
    if (countPanes(root) <= 1) return;

    const findAndRemove = (node: SplitNode): SplitNode | null => {
      if (node.type === 'leaf') {
        return node.paneId === paneId ? null : node;
      }

      if (node.children) {
        const newChildren = node.children
          .map(child => findAndRemove(child))
          .filter((child): child is SplitNode => child !== null);

        // If only one child remains, promote it to avoid unnecessary nesting
        if (newChildren.length === 1) {
          return newChildren[0];
        }

        // Recalculate sizes
        const removedIndices = node.children
          .map((child, i) => (findAndRemove(child) === null ? i : -1))
          .filter(i => i !== -1);

        const newSizes = node.sizes?.filter((_, i) => !removedIndices.includes(i)) || [];
        const sizeSum = newSizes.reduce((a, b) => a + b, 0);
        const adjustedSizes = newSizes.map(s => (s / sizeSum) * 100);

        return {
          ...node,
          children: newChildren,
          sizes: adjustedSizes,
        };
      }

      return node;
    };

    const newRoot = findAndRemove(root);
    if (newRoot) {
      setRoot(newRoot);

      // Remove the pane from panes array
      setPanes(prev => prev.filter(p => p.id !== paneId));

      // Update active pane if needed
      if (activePane === paneId) {
        const getFirstPane = (node: SplitNode): string | undefined => {
          if (node.type === 'leaf') return node.paneId;
          return node.children?.[0] ? getFirstPane(node.children[0]) : undefined;
        };
        setActivePane(getFirstPane(newRoot) || '');
      }
    }
  }, [root, activePane]);

  // Handle resize
  const handleResizeStart = useCallback((node: SplitNode, index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setResizing({ node, index });
  }, []);

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || !resizing.node.children || !resizing.node.sizes) return;

      const rect = containerRef.current.getBoundingClientRect();
      const isHorizontal = resizing.node.type === 'horizontal';
      const totalSize = isHorizontal ? rect.width : rect.height;
      const position = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top;
      const percentage = (position / totalSize) * 100;

      // Calculate cumulative size up to the resize handle
      let cumulative = 0;
      for (let i = 0; i < resizing.index; i++) {
        cumulative += resizing.node.sizes[i];
      }

      const diff = percentage - cumulative - resizing.node.sizes[resizing.index];
      const minSize = 10; // Minimum 10%

      const newSizes = [...resizing.node.sizes];
      const leftSize = newSizes[resizing.index] + diff;
      const rightSize = newSizes[resizing.index + 1] - diff;

      if (leftSize >= minSize && rightSize >= minSize) {
        newSizes[resizing.index] = leftSize;
        newSizes[resizing.index + 1] = rightSize;

        const updateSizes = (node: SplitNode): SplitNode => {
          if (node === resizing.node) {
            return { ...node, sizes: newSizes };
          }
          if (node.children) {
            return { ...node, children: node.children.map(updateSizes) };
          }
          return node;
        };

        setRoot(prev => updateSizes(prev));
      }
    };

    const handleMouseUp = () => {
      setResizing(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+D: Split vertically (down)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        splitPane(activePane, 'vertical');
      }
      // Ctrl+Shift+R: Split horizontally (right)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        splitPane(activePane, 'horizontal');
      }
      // Ctrl+Shift+W: Close active pane
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        closePane(activePane);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activePane, splitPane, closePane]);

  // Calculate layout bounds for each pane from the tree structure
  const calculatePaneLayouts = useCallback((node: SplitNode, bounds: { left: number; top: number; width: number; height: number }): Map<string, { left: number; top: number; width: number; height: number }> => {
    const layouts = new Map<string, { left: number; top: number; width: number; height: number }>();

    if (node.type === 'leaf' && node.paneId) {
      layouts.set(node.paneId, bounds);
      return layouts;
    }

    if (node.children && node.sizes) {
      let offset = 0;
      node.children.forEach((child, index) => {
        const size = node.sizes![index];
        const childBounds = node.type === 'horizontal'
          ? {
              left: bounds.left + (offset / 100) * bounds.width,
              top: bounds.top,
              width: (size / 100) * bounds.width,
              height: bounds.height,
            }
          : {
              left: bounds.left,
              top: bounds.top + (offset / 100) * bounds.height,
              width: bounds.width,
              height: (size / 100) * bounds.height,
            };

        const childLayouts = calculatePaneLayouts(child, childBounds);
        childLayouts.forEach((layout, paneId) => layouts.set(paneId, layout));
        offset += size;
      });
    }

    return layouts;
  }, []);

  // Memoize layout calculations
  const paneLayouts = useMemo(() => {
    return calculatePaneLayouts(root, { left: 0, top: 0, width: 100, height: 100 });
  }, [root, calculatePaneLayouts]);

  // Get a stable key for a node (based on pane IDs in the subtree)
  const getNodeKey = (node: SplitNode): string => {
    if (node.type === 'leaf' && node.paneId) {
      return node.paneId;
    }
    if (node.children) {
      return node.children.map(getNodeKey).join('-');
    }
    return 'unknown';
  };

  // Render layout structure (handles, containers) without terminals
  const renderLayoutNode = (node: SplitNode): React.ReactNode => {
    if (node.type === 'leaf' && node.paneId) {
      const isActive = activePane === node.paneId;
      return (
        <div
          className={`split-pane ${isActive ? 'active' : ''}`}
          onClick={() => setActivePane(node.paneId!)}
          data-pane-id={node.paneId}
        >
          <div className="pane-header">
            <span className="pane-title">Terminal</span>
            <div className="pane-actions">
              <button
                className="pane-action"
                onClick={(e) => { e.stopPropagation(); splitPane(node.paneId!, 'horizontal'); }}
                title="Split Right (Ctrl+Shift+R)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="12" y1="3" x2="12" y2="21"/>
                </svg>
              </button>
              <button
                className="pane-action"
                onClick={(e) => { e.stopPropagation(); splitPane(node.paneId!, 'vertical'); }}
                title="Split Down (Ctrl+Shift+D)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                </svg>
              </button>
              <button
                className="pane-action close"
                onClick={(e) => { e.stopPropagation(); closePane(node.paneId!); }}
                title="Close Pane (Ctrl+Shift+W)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="pane-content">
            {/* Terminal is rendered in the flat layer below */}
          </div>
        </div>
      );
    }

    if (node.children && node.sizes) {
      return (
        <div className={`split-container ${node.type}`}>
          {node.children.map((child, index) => (
            <React.Fragment key={getNodeKey(child)}>
              <div
                className="split-child"
                style={{
                  [node.type === 'horizontal' ? 'width' : 'height']: `${node.sizes![index]}%`,
                }}
              >
                {renderLayoutNode(child)}
              </div>
              {index < node.children!.length - 1 && (
                <div
                  className={`split-handle ${node.type}`}
                  onMouseDown={(e) => handleResizeStart(node, index, e)}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="split-terminal-root" ref={containerRef}>
      {/* Layout structure layer */}
      <div className="split-layout-layer">
        {renderLayoutNode(root)}
      </div>
      {/* Terminals layer - rendered flat to prevent remounting */}
      <div className="split-terminals-layer">
        {panes.map(pane => {
          const layout = paneLayouts.get(pane.id);
          if (!layout) return null;
          return (
            <div
              key={pane.id}
              className="terminal-wrapper"
              style={{
                left: `${layout.left}%`,
                top: `${layout.top}%`,
                width: `${layout.width}%`,
                height: `${layout.height}%`,
              }}
            >
              <Terminal
                ref={(terminalRef) => {
                  if (terminalRef) {
                    terminalRefs.current.set(pane.id, terminalRef);
                  } else {
                    terminalRefs.current.delete(pane.id);
                  }
                }}
                connectionId={pane.connectionId}
                initialPath={pane.initialPath}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default SplitTerminal;
