function configuredOwnerIdentity() {
  const single = String(process.env.HIKING_ADMIN_IDENTITY || '').trim();
  if (single) return single.includes(',') ? '' : single;
  const legacy = String(process.env.HIKING_ADMIN_IDENTITIES || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  return legacy.length === 1 ? legacy[0] : '';
}

exports.isOwnerAdmin = identity => {
  const owner = configuredOwnerIdentity();
  return typeof identity === 'string' && identity.length > 0 && owner.length > 0 && identity === owner;
};

exports.ownerAdminConfigured = () => configuredOwnerIdentity().length > 0;
