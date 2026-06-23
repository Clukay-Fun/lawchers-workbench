/**
 * @deprecated 该自动脱敏服务已废弃。
 * 后续已统一升级为集成 Python legal-desensitizer CLI 的高保真脱敏引擎 (redactService.js)。
 */

export async function desensitizeText(rawText) {
  console.warn('[DEPRECATED] desensitizeText in desensitizeService.js is deprecated.');
  return {
    markedText: rawText,
    desensitizedText: rawText,
    sensitiveItems: []
  };
}

// #endregion
