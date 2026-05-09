const fs = require('fs');

const USERNAME = 'donnellyCodes';
const TOKEN = process.env.GH_TOKEN;

const headers = {
  'Authorization': `token ${TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'readme-stats-bot'
};

async function fetchJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function getAllRepos() {
  let repos = [];
  let page = 1;
  while (true) {
    const data = await fetchJSON(`https://api.github.com/users/${USERNAME}/repos?per_page=100&page=${page}`);
    if (data.length === 0) break;
    repos = repos.concat(data);
    page++;
  }
  return repos;
}

async function getTotalStars(repos) {
  return repos.reduce((acc, repo) => acc + repo.stargazers_count, 0);
}

async function getTotalCommits(repos) {
  let total = 0;
  for (const repo of repos) {
    try {
      const data = await fetchJSON(
        `https://api.github.com/repos/${USERNAME}/${repo.name}/commits?author=${USERNAME}&per_page=1`
      );
      // GitHub returns Link header with last page = total commits
      // We use a simpler approach: count via stats
      const statsRes = await fetch(
        `https://api.github.com/repos/${USERNAME}/${repo.name}/contributors`,
        { headers }
      );
      const stats = await statsRes.json();
      if (Array.isArray(stats)) {
        const me = stats.find(c => c.login === USERNAME);
        if (me) total += me.contributions;
      }
    } catch (e) {
      // skip repos that error
    }
  }
  return total;
}

async function getTotalPRs() {
  const data = await fetchJSON(
    `https://api.github.com/search/issues?q=type:pr+author:${USERNAME}&per_page=1`
  );
  return data.total_count || 0;
}

async function getTotalIssues() {
  const data = await fetchJSON(
    `https://api.github.com/search/issues?q=type:issue+author:${USERNAME}&per_page=1`
  );
  return data.total_count || 0;
}

async function getContributionStats() {
  // Use GraphQL for contribution data
  const query = `
    query {
      user(login: "${USERNAME}") {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
        createdAt
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const data = await res.json();
  const calendar = data?.data?.user?.contributionsCollection?.contributionCalendar;
  const createdAt = data?.data?.user?.createdAt;

  if (!calendar) return { total: 0, streak: 0, streakStart: '', streakEnd: '', joinDate: '' };

  // Flatten all days
  const days = calendar.weeks.flatMap(w => w.contributionDays).sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate longest streak
  let longestStreak = 0;
  let currentStreak = 0;
  let streakStart = '';
  let streakEnd = '';
  let tempStart = '';

  for (const day of days) {
    if (day.contributionCount > 0) {
      if (currentStreak === 0) tempStart = day.date;
      currentStreak++;
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
        streakStart = tempStart;
        streakEnd = day.date;
      }
    } else {
      currentStreak = 0;
    }
  }

  const joinDate = createdAt ? new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Oct 10, 2020';

  return {
    total: calendar.totalContributions,
    streak: longestStreak,
    streakStart,
    streakEnd,
    joinDate
  };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

async function updateReadme(stats) {
  const readmePath = 'README.md';
  let content = fs.readFileSync(readmePath, 'utf8');

  const table = `### 📈 Contribution Highlights

| Metric | Value |
|---|---|
| ⭐ Total Stars Earned | ${formatNumber(stats.stars)} |
| 💻 Total Commits (${new Date().getFullYear()}) | ${stats.commits} |
| 🔀 Total Pull Requests | ${stats.prs} |
| 🐛 Total Issues | ${stats.issues} |
| 📅 Total Contributions (${stats.joinDate} – Present) | ${stats.contributions.toLocaleString()} |
| 🔥 Longest Streak | ${stats.streak} days (${formatDate(stats.streakStart)} – ${formatDate(stats.streakEnd)}) |

<!-- STATS_UPDATED: ${new Date().toISOString()} -->`;

  // Replace the section between ### 📈 Contribution Highlights and the next ---
  const regex = /### 📈 Contribution Highlights[\s\S]*?(?=---)/;
  if (regex.test(content)) {
    content = content.replace(regex, table + '\n\n');
  } else {
    console.log('Section not found in README, appending...');
    content += '\n' + table;
  }

  fs.writeFileSync(readmePath, content, 'utf8');
  console.log('✅ README updated successfully!');
  console.log('Stats:', stats);
}

async function main() {
  console.log('🔄 Fetching GitHub stats for', USERNAME);

  const repos = await getAllRepos();
  console.log(`📦 Found ${repos.length} repos`);

  const [stars, prs, issues, contribData] = await Promise.all([
    getTotalStars(repos),
    getTotalPRs(),
    getTotalIssues(),
    getContributionStats()
  ]);

  const commits = await getTotalCommits(repos);

  const stats = {
    stars,
    commits,
    prs,
    issues,
    contributions: contribData.total,
    streak: contribData.streak,
    streakStart: contribData.streakStart,
    streakEnd: contribData.streakEnd,
    joinDate: contribData.joinDate
  };

  await updateReadme(stats);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
