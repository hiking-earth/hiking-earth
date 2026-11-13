// team-current：恢复当前身份加入的活动队伍（只返回调用者自己的成员关系）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });

exports.main = async () => {
  const OPENID = require('../../identity').currentIdentity();
  if (!OPENID) return { errMsg: '请先登录' };
  const memberships = (await db.collection('team_members').where({ openid: OPENID }).limit(100).get()).data;
  const byTeam = new Map();
  for (const member of memberships) {
    if (typeof member.teamId !== 'string' || !member.teamId) continue;
    const prior = byTeam.get(member.teamId);
    if (!prior || (Number(member.joinedAt) || 0) > (Number(prior.joinedAt) || 0)) byTeam.set(member.teamId, member);
  }
  const teamIds = [...byTeam.keys()];
  if (!teamIds.length) return { teams: [], hasMore: memberships.length >= 100 };
  const activeRows = (await db.collection('teams').where({ _id: db.command.in(teamIds) }).limit(100).get()).data;
  const activeTeams = new Map(activeRows.filter(team => team?.active === true).map(team => [team._id, team]));
  const teams = [];
  for (const [teamId, member] of byTeam) {
    const team = activeTeams.get(teamId);
    if (!team) continue;
    teams.push({ team: { id: teamId, name: team.name, inviteCode: team.inviteCode, createdBy: team.createdBy,
      createdAt: team.createdAt, active: true }, joinedAt: Number(member.joinedAt) || Number(team.createdAt) || 0 });
  }
  teams.sort((a, b) => b.joinedAt - a.joinedAt || a.team.id.localeCompare(b.team.id));
  return { teams: teams.map(item => item.team), hasMore: memberships.length >= 100 };
};
