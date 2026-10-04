using System;

using System.Collections.Generic;

using System.Diagnostics;

using System.IO;

using System.Linq;

using System.Net;

using System.Net.Http;

using System.Net.Http.Headers;

using System.Net.Sockets;

using System.Security.Cryptography;

using System.Text;

using System.Threading;

using System.Threading.Tasks;



public sealed class GoogleClient {public string ClientId,ClientSecret;public static GoogleClient Parse(string json){var data=Protocol.Json.DeserializeObject(json);string id=Protocol.Pick(data,"installed.client_id"),secret=Protocol.Pick(data,"installed.client_secret");if(!id.EndsWith(".apps.googleusercontent.com")||secret=="")throw new ArgumentException("Choose Google's downloaded credentials JSON for a Desktop app.");return new GoogleClient{ClientId=id,ClientSecret=secret};}}

public sealed class YouTubeTokens {public string ClientId,Access,Refresh;public DateTime Expires;}

public sealed class YouTubeError:Exception {public readonly int Code;public readonly string Reason;public YouTubeError(int code,string reason):base("YouTube request failed (HTTP "+code+")."){Code=code;Reason=reason;}}

public static class GoogleLogin {

 public static string Random(){byte[] bytes=new byte[32];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);return Base64(bytes);}

 static string Base64(byte[] value){return Convert.ToBase64String(value).TrimEnd('=').Replace('+','-').Replace('/','_');}

 public static string Challenge(string verifier){using(var sha=SHA256.Create())return Base64(sha.ComputeHash(Encoding.ASCII.GetBytes(verifier)));}

 public static Dictionary<string,string> Query(string query){var result=new Dictionary<string,string>();foreach(string part in query.TrimStart('?').Split('&')){var bits=part.Split(new[]{'='},2);if(bits.Length==2)result[Uri.UnescapeDataString(bits[0])]=Uri.UnescapeDataString(bits[1].Replace('+',' '));}return result;}

 public static async Task<string[]> Authorize(GoogleClient client,Action<string> status,CancellationToken ct){var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct)){timeout.CancelAfter(TimeSpan.FromMinutes(5));using(timeout.Token.Register(()=>listener.Stop())){try{int port=((IPEndPoint)listener.LocalEndpoint).Port;string redirect="http://127.0.0.1:"+port+"/",verifier=Random(),state=Random();string url="https://accounts.google.com/o/oauth2/v2/auth?client_id="+Uri.EscapeDataString(client.ClientId)+"&redirect_uri="+Uri.EscapeDataString(redirect)+"&response_type=code&scope="+Uri.EscapeDataString("https://www.googleapis.com/auth/youtube.force-ssl")+"&access_type=offline&prompt=select_account%20consent&state="+state+"&code_challenge="+Challenge(verifier)+"&code_challenge_method=S256";status("YouTube: approve sign-in in your browser");Process.Start(new ProcessStartInfo(url){UseShellExecute=true});while(true){using(var socket=await listener.AcceptTcpClientAsync())using(var stream=socket.GetStream())using(var requestTimeout=CancellationTokenSource.CreateLinkedTokenSource(timeout.Token)){requestTimeout.CancelAfter(10000);var header=new StringBuilder();byte[] b=new byte[1];while(header.Length<16384&&!header.ToString().EndsWith("\r\n\r\n")){int n=await stream.ReadAsync(b,0,1,requestTimeout.Token);if(n==0)break;header.Append((char)b[0]);}string first=header.ToString().Split('\n')[0].Trim();var parts=first.Split(' ');Uri incoming;bool valid=parts.Length==3&&parts[0]=="GET"&&parts[1].StartsWith("/?")&&Uri.TryCreate(redirect.TrimEnd('/')+parts[1],UriKind.Absolute,out incoming);var query=valid?Query(parts[1].Substring(2)):new Dictionary<string,string>();string returnedState,code,error;bool match=query.TryGetValue("state",out returnedState)&&returnedState==state;bool success=match&&query.TryGetValue("code",out code)&&code!="";string body=success?"Authorization received. Return to UniversalStream Assist to check the connection.":"This sign-in could not be accepted. Return to UniversalStream Assist.";byte[] response=Encoding.UTF8.GetBytes("HTTP/1.1 "+(success?"200 OK":"400 Bad Request")+"\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: "+Encoding.UTF8.GetByteCount(body)+"\r\n\r\n"+body);await stream.WriteAsync(response,0,response.Length,requestTimeout.Token);if(success)return new[]{query["code"],redirect,verifier};if(match&&query.TryGetValue("error",out error))throw new TwitchSignInRequired("YouTube sign-in was declined. Connect again when ready.");}}}catch(SocketException){timeout.Token.ThrowIfCancellationRequested();throw;}catch(ObjectDisposedException){timeout.Token.ThrowIfCancellationRequested();throw;}finally{listener.Stop();}}}}

}

public sealed class YouTubeEvents {

 readonly HashSet<string> seen=new HashSet<string>();readonly Queue<string> order=new Queue<string>();readonly DateTimeOffset since;

 public YouTubeEvents(DateTimeOffset since){this.since=since;}

 public Alert Parse(object item){DateTimeOffset time;if(!DateTimeOffset.TryParse(Protocol.Pick(item,"snippet.publishedAt"),out time)||time<since)return null;string id=Protocol.Pick(item,"id");if(id!=""){if(!seen.Add(id))return null;order.Enqueue(id);while(order.Count>10000)seen.Remove(order.Dequeue());}string kind,detail;switch(Protocol.Pick(item,"snippet.type")){case "textMessageEvent":kind="Chat";detail=Protocol.Pick(item,"snippet.textMessageDetails.messageText","snippet.displayMessage");break;case "superChatEvent":kind="SuperChat";detail=Protocol.Pick(item,"snippet.superChatDetails.amountDisplayString")+"  "+Protocol.Pick(item,"snippet.superChatDetails.userComment");break;case "superStickerEvent":kind="SuperSticker";detail=Protocol.Pick(item,"snippet.superStickerDetails.amountDisplayString")+"  "+Protocol.Pick(item,"snippet.superStickerDetails.superStickerMetadata.altText");break;case "newSponsorEvent":kind="NewSponsor";detail="Membership: "+Protocol.Pick(item,"snippet.newSponsorDetails.memberLevelName");break;case "memberMilestoneChatEvent":kind="MemberMileStone";detail=Protocol.Pick(item,"snippet.memberMilestoneChatDetails.memberMonth")+" months  "+Protocol.Pick(item,"snippet.memberMilestoneChatDetails.userComment");break;case "membershipGiftingEvent":kind="MembershipGift";detail=Protocol.Pick(item,"snippet.membershipGiftingDetails.giftMembershipsCount")+" gifted memberships";break;default:return null;}return new Alert{Time=time.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"),Platform="YouTube",Kind=kind,Name=Protocol.Pick(item,"authorDetails.displayName"),Detail=detail.Trim()};}

}

public sealed class DirectYouTube:IDisposable {

 readonly HttpClient http=new HttpClient(new HttpClientHandler{AllowAutoRedirect=false,UseCookies=false}){Timeout=TimeSpan.FromSeconds(25),MaxResponseContentBufferSize=4194304};readonly Action<string> status;readonly Action<Alert> alert;readonly GoogleClient client;readonly Action<string> identity;YouTubeTokens tokens;

 public DirectYouTube(GoogleClient client,Action<string> status,Action<Alert> alert,Action<string> identity=null){this.client=client;this.status=status;this.alert=alert;this.identity=identity;}

 async Task<object> Request(string url,Dictionary<string,string> form,CancellationToken ct){using(var req=new HttpRequestMessage(form==null?HttpMethod.Get:HttpMethod.Post,url)){if(form!=null)req.Content=new FormUrlEncodedContent(form);else req.Headers.Authorization=new AuthenticationHeaderValue("Bearer",tokens.Access);using(var response=await http.SendAsync(req,ct)){var json=Protocol.Json.DeserializeObject(await response.Content.ReadAsStringAsync());if(!response.IsSuccessStatusCode){var errors=Protocol.Items(Protocol.Get(json,"error.errors"));string reason=errors!=null&&errors.Length>0?Protocol.Pick(errors[0],"reason"):Protocol.Pick(json,"error");throw new YouTubeError((int)response.StatusCode,reason);}return json;}}}

 void Save(object response){string access=Protocol.Pick(response,"access_token"),refresh=Protocol.Pick(response,"refresh_token");if(access=="")throw new TwitchSignInRequired("Google did not complete sign-in. Please reconnect.");if(refresh==""&&tokens!=null)refresh=tokens.Refresh;int expiry;if(!int.TryParse(Protocol.Pick(response,"expires_in"),out expiry))expiry=3600;tokens=new YouTubeTokens{ClientId=client.ClientId,Access=access,Refresh=refresh,Expires=DateTime.UtcNow.AddSeconds(expiry)};try{AccountStore.Save("youtube",tokens);}catch(Exception){throw new TwitchSignInRequired("Windows could not securely save your YouTube sign-in. Check profile access and try again.");}}

 async Task Fresh(CancellationToken ct){ct.ThrowIfCancellationRequested();tokens=await TokenRenewal.YouTube(tokens.Expires==DateTime.MinValue,tokens.Access);}

 public async Task Run(CancellationToken ct){try{tokens=AccountStore.Read<YouTubeTokens>("youtube");if(tokens==null||tokens.ClientId!=client.ClientId){var login=await GoogleLogin.Authorize(client,status,ct);Save(await Request("https://oauth2.googleapis.com/token",new Dictionary<string,string>{{"client_id",client.ClientId},{"client_secret",client.ClientSecret},{"code",login[0]},{"redirect_uri",login[1]},{"code_verifier",login[2]},{"grant_type","authorization_code"}},ct));}await Fresh(ct);var channels=await Request("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",null,ct);ct.ThrowIfCancellationRequested();var list=Protocol.Items(Protocol.Get(channels,"items"))??new object[0];if(identity!=null)identity(list.Length==0?"No YouTube channel on the selected account":String.Join(", ",list.Select(x=>Protocol.Pick(x,"snippet.title")+" · "+Protocol.Pick(x,"id"))));var events=new YouTubeEvents(DateTimeOffset.UtcNow);string chat="",page="",title="";int delay=0,unauthorized=0;while(!ct.IsCancellationRequested){if(delay>0)await Task.Delay(delay,ct);delay=20000;try{await Fresh(ct);if(chat==""){var live=await Request("https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&maxResults=50",null,ct);var broadcasts=Protocol.Items(Protocol.Get(live,"items"))??new object[0];var current=broadcasts.FirstOrDefault(x=>Protocol.Pick(x,"snippet.liveChatId")!="");if(current==null){status("YouTube connected · Waiting for your live broadcast.");delay=60000;continue;}chat=Protocol.Pick(current,"snippet.liveChatId");title=Protocol.Pick(current,"snippet.title");page="";}

 var messages=await Request("https://www.googleapis.com/youtube/v3/liveChat/messages?part=id,snippet,authorDetails&maxResults=2000&liveChatId="+Uri.EscapeDataString(chat)+(page==""?"":"&pageToken="+Uri.EscapeDataString(page)),null,ct);foreach(var item in Protocol.Items(Protocol.Get(messages,"items"))??new object[0]){var parsed=events.Parse(item);if(parsed!=null)alert(parsed);}unauthorized=0;page=Protocol.Pick(messages,"nextPageToken");int minimum;if(int.TryParse(Protocol.Pick(messages,"pollingIntervalMillis"),out minimum))delay=Math.Max(20000,Math.Min(minimum,300000));status("YouTube live · "+title);if(Protocol.Pick(messages,"offlineAt")!=""){chat="";page="";delay=60000;}

 }catch(YouTubeError e){if(e.Code==401){if(++unauthorized>1)throw new TwitchSignInRequired("YouTube sign-in is not accepted. Forget the sign-in in Accounts and reconnect.");tokens.Expires=DateTime.MinValue;delay=1000;continue;}if(e.Reason=="liveChatEnded"||e.Reason=="liveChatNotFound"||e.Reason=="liveChatDisabled"){chat="";page="";status("YouTube: waiting for an available live chat.");delay=60000;continue;}if(e.Reason=="quotaExceeded"||e.Reason=="dailyLimitExceeded")throw new TwitchSignInRequired("YouTube API quota reached. Reconnect after your Google quota resets.");if(e.Reason=="pageTokenInvalid"){page="";continue;}if(e.Reason=="liveStreamingNotEnabled")throw new TwitchSignInRequired("Live streaming is not enabled on this channel. Check the account shown in Connections, or Sign out and choose another account.");if(e.Code==403)throw new TwitchSignInRequired("YouTube access unavailable. Check that YouTube Data API v3 is enabled and your account has access.");status("YouTube: request failed. Retrying in one minute.");delay=60000;}catch(TwitchSignInRequired){throw;}catch(OperationCanceledException){if(ct.IsCancellationRequested)throw;status("YouTube: request timed out. Retrying…");delay=60000;}catch(Exception){status("YouTube: connection interrupted. Retrying in one minute.");delay=60000;}}}catch(TwitchSignInRequired e){status(e.Message);}catch(OperationCanceledException){status(ct.IsCancellationRequested?"YouTube: disconnected":"YouTube sign-in timed out. Please reconnect.");}catch(YouTubeError e){status("YouTube setup failed (HTTP "+e.Code+"). Check your Desktop app credentials and test-user access.");}catch(Exception){status("YouTube could not sign in. Check your internet connection and Google setup.");}}

 public void Dispose(){http.Dispose();}

}



