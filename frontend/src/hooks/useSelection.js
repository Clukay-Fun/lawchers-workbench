import { useState, useCallback } from 'react';

/**
 * 描述: 编辑器鼠标划词脱敏 Hook
 * 主要功能:
 *     - 捕获鼠标在段落文本中的划词行为并定位对应数据块
 *     - 提供选区文本、偏移位置及绝对定位矩形坐标，以驱动浮动脱敏菜单 Popover
 */

// #region 划词逻辑 Hook 实现

/**
 * 划词检测 Hook
 * @returns {Object} 包含 selectionInfo, handleMouseUp 处理函数与 clearSelection 方法
 * 
 * 功能:
 *     - 监视鼠标抬起选区状态，计算选区对应的 DOM 数据块索引和可视矩形坐标
 */
export function useSelection() {
  const [selectionInfo, setSelectionInfo] = useState(null);

  /**
   * 鼠标抬起时的事件回调
   * @param {MouseEvent} e 鼠标事件
   */
  const handleMouseUp = useCallback((e) => {
    // 忽略鼠标右键，交由右键上下文菜单单独处理
    if (e.button === 2) return;

    // 延迟执行，确保浏览器选区对象完全生成
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setSelectionInfo(null);
        return;
      }

      try {
        const range = sel.getRangeAt(0);
        const selectedText = sel.toString().trim();

        // 寻找当前选区节点所属的具有 data-chunk-index 的容器
        let node = range.commonAncestorContainer;
        if (node.nodeType === 3) {
          node = node.parentNode;
        }

        const chunkElement = node.closest('[data-chunk-index]');
        if (!chunkElement) {
          setSelectionInfo(null);
          return;
        }

        const chunkIndex = parseInt(chunkElement.getAttribute('data-chunk-index'), 10);
        const rect = range.getBoundingClientRect();

        // 缓存本次合法的选区结构及排版矩形坐标
        setSelectionInfo({
          selectedText,
          chunkIndex,
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          rect: {
            top: rect.top + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
            height: rect.height,
          },
        });
      } catch (err) {
        console.error('划词选区解析异常:', err);
        setSelectionInfo(null);
      }
    }, 0);
  }, []);

  /**
   * 清除系统当前选区并重置划词数据状态
   */
  const clearSelection = useCallback(() => {
    try {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
      }
    } catch {
      // 容错处理
    }
    setSelectionInfo(null);
  }, []);

  return {
    selectionInfo,
    handleMouseUp,
    clearSelection,
  };
}

// #endregion
